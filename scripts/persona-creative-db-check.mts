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
 *   ⑥ 🔴 이어 하기 — 앞 결과 3명 보존(호출 0) · 없는 3명만 호출 · 원자적 합치기 · retry 전부 실패여도 보존 ·
 *      남은 상한 부족 → 호출 0 · 망가진 / 다른 실행의 파일 → 부르기 전에 멈춤
 *   ⑦ 🔴 batch — 6명 호출 1회 · 원문/식별자 0 · 압축 avoid · 누락 · 중복 · 상한 → fail-closed ·
 *      정상 6명 canonical valid · 실측 5명 파일 품질 FAIL → --apply 거부
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
const { noGoExpressionKey } = await import('../src/lib/persona-no-go')
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
/** 🔴 provider 가 내는 모양 — 말버릇은 따옴표 없는 글자만(코드가 정본으로 감싼다) */
const providerOf = (c: PersonaCreative): Record<string, unknown> => ({ ...c, noGoExpressions: c.noGoExpressions.map(noGoExpressionKey) })
const providerMap = (m: Record<string, PersonaCreative>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, providerOf(v)]))
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
  const mine = await prisma.persona.findMany({ where: { code: { in: [CADENCE_CODE, 'P31'] }, user: { name: { startsWith: NAME_PREFIX } } }, select: { id: true, userId: true } })
  // 🔴 이 검사의 후보 코드(P26~P33) draft — 정상이면 0 행이다. 적재 게이트를 없앤 변이가 남긴 행까지 치운다
  //    (그대로 두면 다음 회차의 후보 코드가 밀려 엉뚱한 이유로 실패한다)
  const drafts = await prisma.persona.findMany({ where: { code: { in: CODES }, status: 'draft' }, select: { id: true, userId: true } })
  const all = [...mine, ...drafts]
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: all.map((m) => m.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: all.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: all.map((m) => m.userId) }, accounts: { none: {} } } })
}

const T = mkdtempSync(join(tmpdir(), 'soran-creative-db-'))
const asset = writeFakePersonaAsset({ home: T, speakers: 40 })
const assetTexts = (JSON.parse(readFileSync(asset.corpus, 'utf-8')) as { comments: { speakerId: string; content: string }[] }).comments
const creativeFile = join(T, 'fake-creative.json')
writeFileSync(creativeFile, JSON.stringify(providerMap(Object.fromEntries(CODES.map((c, i) => [c, creativeOf(i)])))))

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

  // ── ⑥ 이어 하기 — 보존분 호출 0 · 없는 후보만 · 원자적 합치기 ──
  console.log('⑥ 🔴 이어 하기 — 앞 결과 보존 · 없는 후보만 부른다')
  {
    // 실측 모양: 앞 실행이 P26 · P27 · P29 를 만들고 P28 · P30 · P31 은 서지 않았다(6명 실행)
    const prior = join(T, 'prior.json')
    const keep = ['P26', 'P27', 'P29']
    const priorRaw = `${JSON.stringify(Object.fromEntries(keep.map((c) => [c, creativeOf(CODES.indexOf(c))])), null, 2)}\n`
    writeFileSync(prior, priorRaw)
    const merged = join(T, 'merged.json')
    const b6 = await counts()
    const r = cli(['--db', '--count=6', '--generate-creative', `--resume-creative=${prior}`, '--prior-usd=0.0226', '--cost-cap=0.027',
      `--creative-out=${merged}`], { FAKE_PROVIDER_CREATIVE_FILE: creativeFile })
    check('CLI 종료 코드 0', r.run.status === 0, r.out.slice(-500))
    check('🔴 시작 화면이 유료라고 말한다 — "LLM 0" 아님', /══ Persona 자동 확장 — 🔴 유료 creative 생성/.test(r.out) && !/══[^\n]*LLM 0[^\n]*══/.test(r.out))
    check('🔴 이번 상한 = min($0.027, $0.05 − $0.0226) = $0.0270', /이번 상한 \$0\.0270/.test(r.out))
    check('🔴 기존 valid 3 + 없는 3 → provider 정확히 3회', r.paid === 3, `paid ${r.paid}`)
    const sentCodes = r.sent.map((l) => (JSON.parse(JSON.parse((JSON.parse(l) as { body: string }).body).messages[0].content) as { persona: { code: string } }).persona.code).sort()
    check('🔴 보존분(P26 · P27 · P29) 호출 0 — 부른 코드는 P28 · P30 · P31', sentCodes.join(',') === 'P28,P30,P31', sentCodes.join(','))
    const bodies = r.sent.map((l) => (JSON.parse(l) as { body: string }).body).join('\n')
    check('🔴 피할 대상에 보존분 creative 전체(변주까지)가 실린다', keep.every((c) => bodies.includes(`fixture 변주 ${CODES.indexOf(c)}`)))
    const m = existsSync(merged) ? JSON.parse(readFileSync(merged, 'utf-8')) as Record<string, PersonaCreative> : {}
    check('🔴 합친 결과 = 보존 3 + 새 3', JSON.stringify(Object.keys(m).sort()) === JSON.stringify(['P26', 'P27', 'P28', 'P29', 'P30', 'P31']))
    check('🔴 보존분 내용이 글자까지 그대로다', keep.every((c) => JSON.stringify(m[c]) === JSON.stringify(creativeOf(CODES.indexOf(c)))))
    check('앞 결과 파일은 건드리지 않는다', readFileSync(prior, 'utf-8') === priorRaw)
    check('임시 파일이 남지 않는다(원자적 rename)', !readFileSync(merged, 'utf-8').includes('.tmp-') && !existsSync(`${merged}.tmp-${r.run.pid}`))
    check('운영 판정 그대로 — 6명 valid', validOf(r.out) === 6, String(validOf(r.out)))
    check('🔴 ⑥ 회차 DB write 0', same(b6, await counts()))

    // 🔴 새 생성이 전부 형식 위반이어도 보존분은 남는다
    const merged2 = join(T, 'merged-2.json')
    const r2 = cli(['--db', '--count=6', '--generate-creative', `--resume-creative=${prior}`, '--prior-usd=0.0226', `--creative-out=${merged2}`], {})
    const m2 = existsSync(merged2) ? JSON.parse(readFileSync(merged2, 'utf-8')) as Record<string, PersonaCreative> : {}
    check('🔴 retry 가 전부 invalid → 호출 3 · 결과 = 보존 3 그대로', r2.paid === 3
      && JSON.stringify(Object.keys(m2).sort()) === JSON.stringify(keep)
      && keep.every((c) => JSON.stringify(m2[c]) === JSON.stringify(creativeOf(CODES.indexOf(c)))), `paid ${r2.paid} · ${Object.keys(m2).join(',')}`)
    check('그 회차 valid 3 (보존분만)', validOf(r2.out) === 3, String(validOf(r2.out)))

    // 🔴 남은 상한이 1회 최악 예약보다 작으면 한 번도 부르지 않는다 — 보존분은 남는다
    const merged3 = join(T, 'merged-3.json')
    const r3 = cli(['--db', '--count=6', '--generate-creative', `--resume-creative=${prior}`, '--prior-usd=0.049', `--creative-out=${merged3}`],
      { FAKE_PROVIDER_CREATIVE_FILE: creativeFile })
    check('🔴 남은 상한 $0.001 < 1회 최악 예약 → provider 0 · 전원 budget-blocked', r3.paid === 0
      && ['P28', 'P30', 'P31'].every((c) => new RegExp(`^  ${c}  budget-blocked`, 'm').test(r3.out)), r3.out.split('── creative 생성')[1]?.slice(0, 500) ?? '')
    check('그 회차 결과 = 보존 3', existsSync(merged3) && JSON.stringify(Object.keys(JSON.parse(readFileSync(merged3, 'utf-8'))).sort()) === JSON.stringify(keep))

    // 🔴 망가진 앞 결과 → 부르기 전에 멈춘다
    const broken = join(T, 'broken.json')
    writeFileSync(broken, JSON.stringify({ P26: { ...creativeOf(0), noGoTopics: [] } }))
    const merged4 = join(T, 'merged-4.json')
    const b4b = await counts()
    const r4 = cli(['--db', '--count=6', '--generate-creative', `--resume-creative=${broken}`, '--prior-usd=0.0226', `--creative-out=${merged4}`], {})
    check('🔴 망가진 이어 하기 파일 → exit 1 · provider 0 · 결과 파일 0 · DB write 0',
      r4.run.status === 1 && r4.paid === 0 && !existsSync(merged4) && same(b4b, await counts()), r4.out.slice(-300))
    // 🔴 다른 실행의 파일(이번 후보 밖 코드)
    const stray = join(T, 'stray.json')
    writeFileSync(stray, JSON.stringify({ P40: creativeOf(0) }))
    const r5 = cli(['--db', '--count=6', '--generate-creative', `--resume-creative=${stray}`, '--prior-usd=0.0226', `--creative-out=${join(T, 'm5.json')}`], {})
    check('🔴 이번 후보 밖 코드가 든 이어 하기 파일 → exit 1 · provider 0', r5.run.status === 1 && r5.paid === 0 && /후보 밖 코드/.test(r5.out))
  }

  // ── ⑦ batch — 여섯 명을 호출 1회로 함께 설계 · 묶음 품질 ──
  console.log('⑦ 🔴 batch — 6명 · 호출 1회 · 형식 fail-closed · 묶음 품질')
  {
    // 🔴 P31 을 격리 DB 의 draft 행으로 잡아 둔다 — 후보가 실측과 같은 P26~P30 · P32 가 된다(P31 · P33 제외 상태)
    const u31 = await prisma.user.create({ data: { name: `${NAME_PREFIX}p31-${Date.now().toString(36)}` }, select: { id: true } })
    await prisma.persona.create({ data: { code: 'P31', userId: u31.id, status: 'draft' } })
    const SIX = ['P26', 'P27', 'P28', 'P29', 'P30', 'P32']
    const good = JSON.parse(readFileSync('scripts/__fixtures__/persona-creative-batch-good.json', 'utf-8')) as Record<string, PersonaCreative>
    const goodFile = join(T, 'batch-good.json')
    writeFileSync(goodFile, JSON.stringify(providerMap(good)))
    const b7 = await counts()

    const out7 = join(T, 'batch-7.json')
    const g7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${out7}`], { FAKE_PROVIDER_CREATIVE_FILE: goodFile })
    check('CLI 종료 코드 0', g7.run.status === 0, g7.out.slice(-500))
    check('🔴 6명 batch → provider 정확히 1회', g7.paid === 1, `paid ${g7.paid}`)
    const req = g7.sent.length === 1 ? JSON.parse((JSON.parse(g7.sent[0]!) as { body: string }).body) as { messages: { content: string }[] } : null
    const payload = req === null ? null : JSON.parse(req.messages[0]!.content) as { candidates: { code: string }[]; avoid: Record<string, unknown>[] }
    check('🔴 payload 후보 = P26 · P27 · P28 · P29 · P30 · P32 (P31 · P33 없음)', JSON.stringify(payload?.candidates.map((c) => c.code)) === JSON.stringify(SIX))
    const body7 = g7.sent.join('\n')
    check('🔴 payload — 합성 자산 댓글 원문 0 · 화자 id 0 · 표시명 · 회원 칸 0',
      !assetTexts.some((c) => body7.includes(c.content) || body7.includes(c.speakerId)) && !/displayName|nickname|userId|\\"name\\"/.test(body7))
    check('🔴 기존 Persona 는 압축(제목 · 성격)만', payload !== null && payload.avoid.every((a) => JSON.stringify(Object.keys(a)) === '["title","personality"]'))
    check('🔴 batch PASS — 형식 parsed · 품질 PASS', /🔴 batch PASS — 형식 parsed · 품질 PASS/.test(g7.out), (/batch (PASS|FAIL)[^\n]*/.exec(g7.out) ?? [''])[0])
    check('🔴 정상 6명 → 전원 canonical valid', validOf(g7.out) === 6 && SIX.every((c) => statusOf(g7.out, c) === 'valid'),
      (g7.out.split('── 후보 판정')[1] ?? '').split('\n').filter((l) => /^  P\d\d  /.test(l)).join(' | '))
    const f7 = existsSync(out7) ? JSON.parse(readFileSync(out7, 'utf-8')) as Record<string, PersonaCreative> : {}
    check('결과 파일 = 6명 그대로 (--supplement 모양)', SIX.every((c) => JSON.stringify(f7[c]) === JSON.stringify(good[c])) && Object.keys(f7).length === 6)
    const providerSent = JSON.parse(readFileSync(goodFile, 'utf-8')) as Record<string, { noGoExpressions: string[] }>
    check('🔴 provider 는 따옴표 없는 말버릇을 냈고(가짜 응답) 결과 파일은 정본 `"말버릇"` 이다',
      SIX.every((c) => providerSent[c]!.noGoExpressions.every((e) => !/["“”]/.test(e)))
      && SIX.every((c) => f7[c]!.noGoExpressions.length > 0 && f7[c]!.noGoExpressions.every((e) => /^"[^"]+"$/.test(e))))
    const sentPayloadOut = g7.sent.length === 1 ? (JSON.parse(g7.sent[0]!) as { body: string }).body : ''
    check('🔴 PASS batch 는 실패 파일을 남기지 않는다', !existsSync(`${out7}.batch-fail.json`) && sentPayloadOut !== '')
    check('🔴 batch 장부 — 호출 1회 · 최악 예약 ≤ batch 상한 $0.0300', /호출 1회 · 입력 \d+ tok · 출력 \d+ tok · 실제 비용 \$[\d.]+ · 최악 예약 \$[\d.]+ \(판정: 최악 예약 ≤ batch 상한 \$0\.0300 · 호출 1회\)/.test(g7.out))

    // 🔴 코드 하나 빠짐 → 전체 invalid · creative 0
    const missFile = join(T, 'batch-miss.json')
    writeFileSync(missFile, JSON.stringify(providerMap(Object.fromEntries(SIX.filter((c) => c !== 'P30').map((c) => [c, good[c]!])))))
    const out7b = join(T, 'batch-7b.json')
    const m7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${out7b}`], { FAKE_PROVIDER_CREATIVE_FILE: missFile })
    check('🔴 코드 누락 → 호출 1 · batch FAIL(형식 invalid) · creative 0 · valid 0', m7.paid === 1 && /batch FAIL — 형식 invalid/.test(m7.out)
      && /빠진 코드: P30/.test(m7.out) && validOf(m7.out) === 0)
    check('🔴 실패 batch 는 --supplement 결과 파일을 쓰지 않는다 · 상태는 .batch-fail.json', !existsSync(out7b) && existsSync(`${out7b}.batch-fail.json`))

    // 🔴 실측 모양 — 3명 형식 통과 · 3명 형식 위반(변주 2개). 품질은 3명만 보고 PASS 라 하면 안 된다
    const partFile = join(T, 'batch-part.json')
    writeFileSync(partFile, JSON.stringify(providerMap(Object.fromEntries(SIX.map((c) => [c,
      ['P26', 'P30', 'P32'].includes(c) ? { ...good[c]!, variations: good[c]!.variations.slice(0, 2) } : good[c]!])))))
    const out7p = join(T, 'batch-7p.json')
    const p7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${out7p}`], { FAKE_PROVIDER_CREATIVE_FILE: partFile })
    check('🔴 3/6 형식 통과 → 품질 INCOMPLETE · batch FAIL', p7.paid === 1 && /batch FAIL — 형식 invalid · 품질 INCOMPLETE/.test(p7.out)
      && /INCOMPLETE: 기대 6명 중 3명 — creative 없음 P26,P30,P32/.test(p7.out), (/batch (PASS|FAIL)[^\n]*/.exec(p7.out) ?? [''])[0])
    check('🔴 3/6 → 묶음 품질 줄도 PASS 가 아니다', /creative 묶음 품질 \(judgeCreativeQuality · 3명 \/ 기대 6명\) 🔴 INCOMPLETE/.test(p7.out))
    const pf = existsSync(`${out7p}.batch-fail.json`) ? JSON.parse(readFileSync(`${out7p}.batch-fail.json`, 'utf-8')) as { status: string; quality: string; partialCreatives: Record<string, unknown> } : null
    check('🔴 3/6 → supplement 파일 0 · 실패 파일에 상태 + 부분 결과', !existsSync(out7p) && pf?.status === 'BATCH_FAIL' && pf.quality === 'INCOMPLETE'
      && JSON.stringify(Object.keys(pf.partialCreatives).sort()) === JSON.stringify(['P27', 'P28', 'P29']))
    const po = (pf as unknown as { providerOutput: Record<string, { variations: string[] }> | null; providerOutputWithheld: string | null } | null)
    check('🔴 실패 파일에 provider 응답 구조가 남는다(사후 진단) — 6명 코드 · 형식 위반 후보의 변주 2개까지',
      po !== null && po.providerOutputWithheld === null && po.providerOutput !== null
      && JSON.stringify(Object.keys(po.providerOutput).sort()) === JSON.stringify(SIX) && po.providerOutput.P30!.variations.length === 2)
    const pfRaw = existsSync(`${out7p}.batch-fail.json`) ? readFileSync(`${out7p}.batch-fail.json`, 'utf-8') : ''
    check('🔴 실패 파일 — 합성 자산 댓글 원문 · 화자 id 0', pfRaw !== '' && !assetTexts.some((c) => pfRaw.includes(c.content) || pfRaw.includes(c.speakerId)))

    // 🔴 실제 canary v3 응답 그대로 재생 — P32 한 글자 말버릇 · P27 자녀 수 변조
    const canaryFile = 'scripts/__fixtures__/persona-creative-canary-v3-provider.json'
    const out7v = join(T, 'batch-7v.json')
    const v7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${out7v}`], { FAKE_PROVIDER_CREATIVE_FILE: canaryFile })
    check('🔴 canary v3 재생 → 호출 1 · batch FAIL · 품질 INCOMPLETE · supplement 파일 0', v7.paid === 1
      && /batch FAIL — 형식 invalid · 품질 INCOMPLETE/.test(v7.out) && !existsSync(out7v), (/batch (PASS|FAIL)[^\n]*/.exec(v7.out) ?? [''])[0])
    check('🔴 canary v3 재생 → P32 "뭐" 형식 FAIL · P27 [LIFE_FACT_CONFLICT] 보고', /P32: noGoExpressions: 따옴표 안이 2자 미만/.test(v7.out)
      && /P27: \[LIFE_FACT_CONFLICT\] "사별 후 직장 다니며 자녀 셋 뒷바라지 중" — 자녀 3명 ≠ 골격 2명/.test(v7.out))
    const vf = existsSync(`${out7v}.batch-fail.json`) ? JSON.parse(readFileSync(`${out7v}.batch-fail.json`, 'utf-8')) as { problems: string[]; providerOutput: unknown } : null
    check('canary v3 실패 파일 — 새 사유 코드 · 응답 구조 보존', vf !== null && vf.problems.some((p) => /\[LIFE_FACT_CONFLICT\]/.test(p)) && vf.providerOutput !== null)

    // 🔴 응답에 댓글 원문이 그대로 섞이면 실패 파일에 응답을 남기지 않는다
    const leakFile = join(T, 'batch-leak.json')
    writeFileSync(leakFile, JSON.stringify(providerMap(Object.fromEntries(SIX.map((c) => [c,
      c === 'P26' ? { ...good[c]!, variations: [assetTexts[0]!.content, '되묻기'] } : good[c]!])))))
    const out7l = join(T, 'batch-7l.json')
    const l7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${out7l}`], { FAKE_PROVIDER_CREATIVE_FILE: leakFile })
    const lf = existsSync(`${out7l}.batch-fail.json`) ? JSON.parse(readFileSync(`${out7l}.batch-fail.json`, 'utf-8')) as { providerOutput: unknown; providerOutputWithheld: string | null } : null
    check('🔴 응답에 댓글 원문 → 실패 파일에 응답 0 · 보류 사유', l7.paid === 1 && lf !== null && lf.providerOutput === null
      && /댓글 원문 \d+건/.test(lf.providerOutputWithheld ?? '') && !readFileSync(`${out7l}.batch-fail.json`, 'utf-8').includes(assetTexts[0]!.content))
    const asSup = cli(['--db', '--count=6', `--supplement=${out7p}.batch-fail.json`], {})
    check('🔴 실패 파일을 --supplement 로 쓰면 엄격 파서가 거부한다', asSup.run.status === 1 && /엄격 검증을 통과하지 못했다/.test(asSup.out))
    // 🔴 중복 키(원문 그대로)
    const ok = JSON.stringify(providerMap(Object.fromEntries(SIX.map((c) => [c, good[c]!]))))
    const dupFile = join(T, 'batch-dup.json')
    writeFileSync(dupFile, JSON.stringify({ __raw__: `${ok.slice(1, -1)},"P27":${JSON.stringify(providerOf(good.P27!))}}` }))
    const d7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', `--creative-out=${join(T, 'batch-7d.json')}`], { FAKE_PROVIDER_CREATIVE_FILE: dupFile })
    check('🔴 코드 중복 → batch FAIL · valid 0', d7.paid === 1 && /중복 코드: P27/.test(d7.out) && validOf(d7.out) === 0, (/batch[^\n]*/.exec(d7.out) ?? [''])[0])
    // 🔴 상한
    const c7 = cli(['--db', '--count=6', '--generate-creative', '--creative-batch', '--cost-cap=0.001', `--creative-out=${join(T, 'batch-7c.json')}`], { FAKE_PROVIDER_CREATIVE_FILE: goodFile })
    check('🔴 최악 예약 > 상한 → provider 0 · batch FAIL', c7.paid === 0 && /batch FAIL — 형식 not-called/.test(c7.out) && /부르지 않았다/.test(c7.out))

    // 🔴 실측 5명 파일 → 품질 FAIL · 적재 거부(write 0)
    const actual = 'scripts/__fixtures__/persona-creative-actual-20261006.json'
    const a7 = cli(['--db', '--count=6', `--supplement=${actual}`], {})
    check('🔴 실측 5명 파일 → 묶음 품질 FAIL', /creative 묶음 품질 \(judgeCreativeQuality · 5명\) 🔴 FAIL/.test(a7.out) && a7.paid === 0)
    const b7a = await counts()
    const ap = cli(['--db', '--count=6', `--supplement=${actual}`, '--apply', '--limit=5', '--reason', 'fixture'], {})
    check('🔴 품질 FAIL 묶음 --apply → exit 1 · 적재 0', ap.run.status === 1 && /creative 묶음 품질 FAIL/.test(ap.out) && same(b7a, await counts()), ap.out.slice(-300))
    check('🔴 ⑦ 회차 DB write 0 (P31 준비 행 제외)', same({ ...b7 }, await counts()))
    await prisma.persona.deleteMany({ where: { code: 'P31', userId: u31.id } })
    await prisma.user.deleteMany({ where: { id: u31.id } })
  }

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
