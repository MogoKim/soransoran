#!/usr/bin/env tsx
/**
 * 🔴 **StageDecision 저장 — 실제 DB 왕복 검증** (2026-09-25)
 *
 * 🔴 **CI 에서는 격리 Postgres 17 컨테이너로 돈다** (`visibility-guard` · heavy 조건).
 *    주소는 그 step 에만 주고, 다른 step 에는 DATABASE_URL 이 없다. 운영 DB 0.
 *    순수 계약은 `stage:ladder-check` 가 본다. 이 파일은 **fixture 로는 잴 수 없는 것**만
 *    본다: 유일키 충돌, JSON null 왕복, DateTime 왕복, 동시 create.
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *    Preview 도 운영 DB 를 공유하므로 그쪽에서도 돌리지 않는다.
 *
 * ── 격리 Postgres 세우는 법 ───────────────────────────────────────────
 *
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
 *   export LANG=C LC_ALL=C                    # 🔴 없으면 initdb 가 로케일 오류로 죽는다
 *   PGDIR=/tmp/soran-pg ; SOCK=/tmp/soran-sock
 *   rm -rf "$PGDIR" "$SOCK" ; mkdir -p "$PGDIR" "$SOCK"
 *   initdb -D "$PGDIR" -U soran --auth=trust -E UTF8 --locale=C
 *   # 🔴 소켓 경로가 103바이트를 넘으면 서버가 뜨지 않는다 — 짧게 준다
 *   pg_ctl -D "$PGDIR" -o "-p 54329 -k $SOCK -h 127.0.0.1" -l "$PGDIR/server.log" start
 *   psql -h 127.0.0.1 -p 54329 -U soran -d postgres -c "create database soran_test;"
 *
 *   export DATABASE_URL="postgresql://soran@127.0.0.1:54329/soran_test"
 *   export DIRECT_URL="$DATABASE_URL"
 *   export SORAN_ISOLATED_DB=yes-throwaway    # 🔴 사람이 직접 적는다 — 없으면 안 돈다
 *   npx prisma migrate deploy
 *   npm run stage:db-check
 *
 *   pg_ctl -D "$PGDIR" stop -m fast ; rm -rf "$PGDIR" "$SOCK"
 */
import { PrismaClient, Prisma } from '@prisma/client'

import {
  createStageDecision, readStageDecision, stageDecisionIo, rowToValidatorInput,
  decisionToCreateInput,
} from '../src/lib/stage-decision-repo'
import {
  validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER,
  type StageDecision, type ValidatedStageDecision,
} from '../src/lib/stage-decision-contract'
import { ensureStageDecision, consumeStageDecision } from '../src/lib/stage-decision-store'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPreflightFacts } from './lib/stage-preflight-facts.mjs'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { buildSourceEvidence, SOURCE_STATS_METHOD } from '../src/lib/source-slot-release'
import { OPPORTUNITY_KIND, OPPORTUNITY_VERSION, WORKSET_KIND, WORKSET_VERSION, opportunitiesFileName, worksetFileName } from '../src/lib/supply-workset'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { profileOf, releaseCapsOf } from '../src/lib/scale-profile'
import { judgeNextPreflight, slotTimesOn } from '../src/lib/stage-ladder-generic'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'

/**
 * 🔴 **격리 DB 가 아니면 여기서 멈춘다 — 그리고 주소를 한 글자도 찍지 않는다.**
 *
 *    앞판은 실패 메시지에 `DATABASE_URL` 앞 40자를 찍었다. 주소에는 사용자명이,
 *    때로는 비밀번호가 들어간다. **잘못 붙였을 때**가 정확히 그 값이 새는 순간이다.
 *    🔴 지금은 무엇이 틀렸는지만 말하고 값은 말하지 않는다.
 *
 * 🔴 **세 가지를 **모두** 요구한다.** 하나만 보면 우연히 맞는 주소가 통과한다:
 *      ① 명시적 sentinel — 사람이 "이건 버려도 되는 DB 다" 라고 직접 적어야 한다
 *      ② localhost / 127.0.0.1
 *      ③ 고정된 시험 DB 이름 (`soran_test`)
 */
const ISOLATION_SENTINEL_ENV = 'SORAN_ISOLATED_DB'
const ISOLATION_SENTINEL = 'yes-throwaway'
const TEST_DB_NAME = 'soran_test'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env[ISOLATION_SENTINEL_ENV] ?? '').trim() !== ISOLATION_SENTINEL) {
  problems.push(`${ISOLATION_SENTINEL_ENV}=${ISOLATION_SENTINEL} 가 없다`)
}
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) {
  problems.push('DATABASE_URL 이 localhost 주소가 아니다')
}
if (!new RegExp(`/${TEST_DB_NAME}(\\?|$)`).test(URL)) {
  problems.push(`DATABASE_URL 의 DB 이름이 ${TEST_DB_NAME} 가 아니다`)
}
if (problems.length > 0) {
  // 🔴 값이 아니라 **무엇이 틀렸는지**만 적는다. 주소도 일부도 찍지 않는다
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  console.error('   세우는 법은 이 파일 맨 위 주석에 있다')
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const DATE = '2026-09-25'
const PREV = '2026-09-24'
const rawDecision = (o: Partial<StageDecision> = {}): StageDecision => ({
  kstDate: DATE, capacity: 'd10', release: 'd5', state: 'TRIAL',
  reasons: ['🟢 오늘 하루 d5 로 낸다'],
  blocks: [{ code: 'PROVENANCE_NEXT', reason: '승격 출처가 어긋났다' }],
  dayPinned: true,
  supply: { eligibleSpeakers: 3, excluded: [{ reason: 'noOpenDay', codes: ['P01', 'P02'] }] },
  decidedAt: `${DATE}T02:15:00.000Z`,
  contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
  transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV, target: 'd5', basis: 'PASS' },  // 🔴 d3 위 시험은 운영 증거 근거가 있어야 한다
  ...o,
})
/**
 * 🔴 **검사도 운영과 같은 문을 지난다.** `ValidatedStageDecision` 은 validator 를
 *    지나야만 만들어진다 — 여기서 손으로 지어낼 수 없다.
 */
const decision = (o: Partial<StageDecision> = {}): ValidatedStageDecision => {
  const v = validateStoredDecision({ row: rawDecision(o), expectKstDate: rawDecision(o).kstDate })
  if (!v.ok) throw new Error(`fixture 가 계약을 지키지 않는다 — ${v.reason}`)
  return v.decision
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  const wipe = async (): Promise<void> => {
    // 🔴 **검사 파일의 청소다** — adapter 에는 삭제 경로가 없다. 격리 DB 에서만 돈다
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "StageDecision"')
  }

  console.log('\n══ StageDecision 저장 — 실제 DB 왕복 (격리 전용) ══')
  // 🔴 주소를 찍지 않는다 — 가려서도 찍지 않는다. 가린 문자열도 길이·모양을 흘린다
  console.log(`   격리 확인됨 (${ISOLATION_SENTINEL_ENV} · localhost · ${TEST_DB_NAME})\n`)

  console.log('① 결정 → DB → 읽기 → validator 왕복')
  {
    await wipe()
    const d = decision()
    check('create 가 행을 만든다', await createStageDecision(prisma, d) === 'inserted')
    const got = await readStageDecision(prisma, DATE)
    check('읽어서 validator 를 통과한다',
      got.found && got.result.ok, got.found && !got.result.ok ? got.result.reason : '')
    if (got.found && got.result.ok) {
      /** 🔴 키 순서는 뜻이 아니다 — 정렬해 비교한다 */
      const norm = (x: unknown): string =>
        JSON.stringify(x, (_k, val) => (val !== null && typeof val === 'object' && !Array.isArray(val)
          ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort())
          : val))
      check('🔴 🔴 **값이 하나도 사라지지 않는다**',
        norm(got.result.decision) === norm(d),
        `${norm(got.result.decision).slice(0, 180)}`)
      check('🔴 dayPinned · supply · transition 이 살아서 돌아온다',
        got.result.decision.dayPinned === true
        && got.result.decision.supply?.excluded[0]?.codes.join(',') === 'P01,P02'
        && got.result.decision.transition?.kind === 'TRIAL')
      check('🔴 decidedAt 이 DateTime 왕복 뒤에도 그날 안이다',
        got.result.decision.decidedAt === d.decidedAt,
        `${got.result.decision.decidedAt} vs ${d.decidedAt}`)
      check('🔴 읽은 값은 얼어 있다 — 받은 쪽이 못 고친다',
        Object.isFrozen(got.result.decision) && Object.isFrozen(got.result.decision.blocks))
    }
  }

  console.log('\n①-b 🔴 insert 에 들어가는 것은 검증기가 만든 불변 사본이다')
  {
    await wipe()
    /**
     * 🔴 앞판 `ensureStageDecision` 은 **검증 전 원본 `fresh`** 를 넘겼다.
     *    계산기가 여전히 참조를 들고 있고 얼어 있지도 않은 객체다 —
     *    저장한 값과 검증한 값이 **다른 객체**였다.
     */
    const rawComputed = rawDecision()
    let seen: unknown = null
    const spy = {
      stageDecision: {
        create: async (a: never) => { return prisma.stageDecision.create(a) },
        findUnique: (a: never) => prisma.stageDecision.findUnique(a),
      },
    } as never
    const r = await ensureStageDecision({
      read: async () => null,
      compute: () => rawComputed,
      insert: async (d) => { seen = d; return createStageDecision(spy, d) },
      validate: (row) => validateStoredDecision({ row, expectKstDate: DATE }),
      by: DECISION_WRITER,
    })
    check('행이 만들어졌다', r.ok && r.created)
    check('🔴 🔴 **insert 가 받은 값은 얼어 있다**',
      seen !== null && Object.isFrozen(seen)
      && Object.isFrozen((seen as { blocks: unknown }).blocks))
    check('🔴 🔴 **raw compute 객체와 같은 객체가 아니다**',
      seen !== rawComputed, seen === rawComputed ? '🔴 같은 객체다' : '')
    check('🔴 raw 원본은 얼어 있지 않다 — 그래서 넘기면 안 됐다',
      !Object.isFrozen(rawComputed))
  }

  console.log('\n② 🔴 JSON null 왕복 — DbNull 과 JsonNull 을 섞지 않는다')
  {
    await wipe()
    const d = decision({ state: 'HOLD', release: 'd5', supply: null, transition: null })
    await createStageDecision(prisma, d)
    const raw = await prisma.stageDecision.findUnique({ where: { kstDate: DATE } })
    check('🔴 🔴 **칼럼이 SQL NULL 이 아니라 JSON `null` 이다**',
      raw !== null && raw.supply === null && raw.transition === null)
    const isSqlNull = await prisma.$queryRawUnsafe<{ a: boolean; b: boolean }[]>(
      'SELECT ("supply" IS NULL) AS a, ("transition" IS NULL) AS b FROM "StageDecision" WHERE "kstDate" = $1',
      DATE,
    )
    check('🔴 🔴 **SQL 수준에서도 NULL 이 아니다 (JsonNull 로 썼다)**',
      isSqlNull[0]?.a === false && isSqlNull[0]?.b === false,
      JSON.stringify(isSqlNull[0]))
    const got = await readStageDecision(prisma, DATE)
    check('그 행도 validator 를 통과한다',
      got.found && got.result.ok, got.found && !got.result.ok ? got.result.reason : '')
    check('🔴 null 이 `undefined` 로 오지 않는다 — 필수 키 누락이 되지 않는다',
      got.found && got.result.ok
      && got.result.decision.supply === null && got.result.decision.transition === null)
  }

  console.log('\n②-b 🔴 SQL NULL 은 DB 가 거절한다 (JSONB NOT NULL)')
  {
    await wipe()
    /**
     * 🔴 **`DbNull` 은 칼럼을 SQL NULL 로 만든다.** 계약은 "키는 언제나 있고, 값이
     *    없으면 JSON `null`" 이다. 칼럼이 `NOT NULL` 이므로 DB 가 그 행을 막는다 —
     *    app 검증을 우회해 직접 넣어도 못 들어간다.
     */
    let threw: string | null = null
    try {
      await prisma.stageDecision.create({
        data: {
          ...decisionToCreateInput(decision()),
          supply: Prisma.DbNull as never,
        },
      })
    } catch (e) { threw = e instanceof Error ? e.message : String(e) }
    check('🔴 🔴 **`DbNull`(SQL NULL)로는 저장되지 않는다**',
      threw !== null && await prisma.stageDecision.count() === 0,
      threw === null ? '🔴 들어가 버렸다' : threw.split('\n').slice(0, 1).join(''))

    /** 🔴 raw SQL 로 직접 NULL 을 넣어도 막힌다 — 제약이 실제로 DB 에 있다 */
    let rawThrew = false
    try {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "StageDecision" ("kstDate","contractVersion","capacity","release","state",'
        + '"reasons","blocks","dayPinned","supply","transition","decidedBy","decidedAt")'
        + ` VALUES ($1,$2,'d10','d5','HOLD','[]'::jsonb,'[]'::jsonb,false,NULL,'null'::jsonb,$3,now())`,
        DATE, STAGE_DECISION_VERSION, DECISION_WRITER,
      )
    } catch { rawThrew = true }
    check('🔴 🔴 **raw SQL 로 NULL 을 넣어도 제약이 막는다**',
      rawThrew && await prisma.stageDecision.count() === 0)

    /** 🔴 `JsonNull` 은 정상이다 — 계약이 말하는 "값 없음" 이다 */
    check('🔴 `JsonNull` 은 그대로 통과한다',
      await createStageDecision(prisma, decision({
        state: 'HOLD', release: 'd5', supply: null, transition: null,
      })) === 'inserted')
  }

  console.log('\n②-c 🔴 검증되지 않은 값은 create 를 부르지 않는다')
  {
    await wipe()
    /**
     * 🔴 **타입은 실수를 막을 뿐 공격을 막지 못한다.** assertion 으로 brand 를 통과시킨
     *    값이 저장까지 가면 immutable 이라 되돌릴 수 없다. 저장 직전에 한 번 더 본다.
     */
    let creates = 0
    const spy = {
      stageDecision: {
        create: async (...a: unknown[]) => { creates += 1; return prisma.stageDecision.create(a[0] as never) },
        findUnique: (a: never) => prisma.stageDecision.findUnique(a),
      },
    } as never
    const bad = [
      ['state 가 정본이 아니다', { ...rawDecision(), state: 'EVIL' }],
      ['release 가 정본이 아니다', { ...rawDecision(), release: 'evil' }],
      ['release 가 천장을 넘는다', { ...rawDecision(), capacity: 'd1', release: 'd5' }],
      ['decidedAt 이 그날이 아니다', { ...rawDecision(), decidedAt: '2020-01-01T00:00:00.000Z' }],
      ['decidedBy 가 controller 가 아니다', { ...rawDecision(), decidedBy: 'publish' }],
      ['TRIAL 인데 전이를 무효로 만드는 block 이 있다', {
        ...rawDecision(), blocks: [{ code: 'PROVENANCE_PREVIOUS', reason: 'x' }],
      }],
    ] as const
    for (const [label, row] of bad) {
      // 🔴 brand 를 억지로 통과시킨다 — 실제 공격이 할 수 있는 일이다
      const r = await createStageDecision(spy, row as unknown as ValidatedStageDecision)
      check(`🔴 🔴 **${label} → rejected · create 0건**`,
        r === 'rejected', `${r} (create ${creates}회)`)
    }
    check('🔴 🔴 **그 여섯 건 동안 `create` 를 한 번도 부르지 않았다**',
      creates === 0, `${creates}회`)
    check('🔴 DB 에도 행이 없다', await prisma.stageDecision.count() === 0)
  }

  console.log('\n③ 🔴 같은 날짜 동시 create — 한 건만 생성되고 패자는 승자를 읽는다')
  {
    await wipe()
    const a = decision({ release: 'd5' })
    const b = decision({
      release: 'd3', state: 'TRIAL',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV, target: 'd3' },
    })
    const [ra, rb] = await Promise.all([
      createStageDecision(prisma, a), createStageDecision(prisma, b),
    ])
    const rows = await prisma.stageDecision.count()
    check('🔴 🔴 **행은 하나뿐이다**', rows === 1, `${rows}건`)
    check('🔴 🔴 **한쪽은 inserted · 다른 쪽은 conflict**',
      [ra, rb].filter((x) => x === 'inserted').length === 1
      && [ra, rb].filter((x) => x === 'conflict').length === 1, `${ra}/${rb}`)

    /** 🔴 진 쪽이 자기 계산을 버리고 **승자 행**을 읽는가 */
    await wipe()
    await createStageDecision(prisma, a)
    const loser = await ensureStageDecision({
      ...stageDecisionIo(prisma, DATE),
      compute: () => b,
      by: DECISION_WRITER,
    })
    check('🔴 🔴 **패자는 승자 행을 읽는다 — 자기 계산을 쓰지 않는다**',
      loser.ok && !loser.created && loser.decision.release === a.release,
      JSON.stringify(loser.ok ? loser.decision.release : loser))
    const after = await prisma.stageDecision.count()
    check('🔴 그 과정에서 행이 늘지도 덮이지도 않는다', after === 1, `${after}건`)
  }

  console.log('\n④ 🔴 같은 날짜 · 다른 contractVersion → 두 번째 행을 만들지 않는다')
  {
    await wipe()
    /** 🔴 옛 판 행을 **직접** 넣는다 — adapter 는 현재 판만 만든다 */
    await prisma.stageDecision.create({
      data: {
        kstDate: DATE, contractVersion: 'stage-decision-v3',
        capacity: 'd10', release: 'd5', state: 'HOLD',
        reasons: [] as unknown as Prisma.InputJsonValue,
        blocks: [] as unknown as Prisma.InputJsonValue,
        dayPinned: false, supply: Prisma.JsonNull, transition: Prisma.JsonNull,
        decidedBy: DECISION_WRITER, decidedAt: new Date(`${DATE}T01:00:00.000Z`),
      },
    })
    const r = await ensureStageDecision({
      ...stageDecisionIo(prisma, DATE), compute: () => decision(), by: DECISION_WRITER,
    })
    check('🔴 🔴 **BROKEN 이다 — 두 번째 행을 만들지 않는다**',
      !r.ok && r.code === 'BROKEN', JSON.stringify(r))
    const rows = await prisma.stageDecision.count()
    check('🔴 행은 여전히 하나다', rows === 1, `${rows}건`)
    const consumed = await consumeStageDecision({
      ...stageDecisionIo(prisma, DATE), controllerOn: true, by: 'publish',
    })
    check('🔴 🔴 **consumer 는 fail-closed 로 간다**',
      !consumed.ok && consumed.code === 'BROKEN' && consumed.fallback === 'safest',
      JSON.stringify(consumed))
  }

  console.log('\n⑤ 🔴 깨진 JSON 행을 consumer 가 차단한다')
  {
    await wipe()
    await prisma.stageDecision.create({
      data: {
        kstDate: DATE, contractVersion: STAGE_DECISION_VERSION,
        capacity: 'd10', release: 'd5', state: 'TRIAL',
        // 🔴 문자열 배열이 아니다 · block 코드가 정본이 아니다
        reasons: 'nope' as unknown as Prisma.InputJsonValue,
        blocks: [{ code: 'EVIL', reason: 'x' }] as unknown as Prisma.InputJsonValue,
        dayPinned: false, supply: Prisma.JsonNull, transition: Prisma.JsonNull,
        decidedBy: DECISION_WRITER, decidedAt: new Date(`${DATE}T01:00:00.000Z`),
      },
    })
    const consumed = await consumeStageDecision({
      ...stageDecisionIo(prisma, DATE), controllerOn: true, by: 'supply',
    })
    check('🔴 🔴 **깨진 행으로 단계를 정하지 않는다**',
      !consumed.ok && consumed.code === 'BROKEN' && consumed.fallback === 'safest',
      JSON.stringify(consumed))
    const got = await readStageDecision(prisma, DATE)
    check('🔴 읽기도 던지지 않고 거절한다', got.found && !got.result.ok)

    /** 🔴 같은 행을 controller 가 봐도 같은 답이다 */
    const ensured = await ensureStageDecision({
      ...stageDecisionIo(prisma, DATE), compute: () => decision(), by: DECISION_WRITER,
    })
    check('🔴 🔴 **controller 와 consumer 가 같은 답을 낸다**',
      !ensured.ok && ensured.code === 'BROKEN')
  }

  console.log('\n⑤-b 🔴 select 에서 칼럼이 빠진 행은 "값 없음" 이 아니다')
  {
    await wipe()
    await createStageDecision(prisma, decision({ state: 'HOLD', release: 'd5', supply: null, transition: null }))
    /**
     * 🔴 **DB select 가 칼럼 하나를 빠뜨린 경우.** `rowToValidatorInput` 이 그것을
     *    `null` 로 메우면 "supply 가 없는 정상 행" 이 되어 통과한다 — fail-open 이다.
     *    빠진 칼럼과 "값이 없음" 은 다른 사실이다.
     */
    const partial = await prisma.stageDecision.findUnique({
      where: { kstDate: DATE },
      select: {
        kstDate: true, contractVersion: true, capacity: true, release: true, state: true,
        reasons: true, blocks: true, dayPinned: true,
        // 🔴 supply 를 일부러 빼 놓는다
        transition: true, decidedBy: true, decidedAt: true,
      },
    })
    const v = validateStoredDecision({
      row: rowToValidatorInput(partial as never), expectKstDate: DATE,
    })
    check('🔴 🔴 **빠진 칼럼을 `null` 로 메우지 않는다 — 거절한다**',
      !v.ok && v.reason.includes('supply'), v.ok ? '🔴 통과해 버림' : v.reason)
    check('🔴 온전히 읽은 같은 행은 통과한다 — 거절이 과하지 않다', (await readStageDecision(prisma, DATE)).found)
  }

  console.log('\n⑥ 🔴 없는 날짜는 사후 생성하지 않는다')
  {
    await wipe()
    const consumed = await consumeStageDecision({
      ...stageDecisionIo(prisma, DATE), controllerOn: true, by: 'publish',
    })
    check('🔴 🔴 **결정이 없으면 NO_DECISION → 가장 안전한 단계**',
      !consumed.ok && consumed.code === 'NO_DECISION' && consumed.fallback === 'safest')
    check('🔴 읽는 것만으로 행이 생기지 않는다', await prisma.stageDecision.count() === 0)
    const off = await consumeStageDecision({
      ...stageDecisionIo(prisma, DATE), controllerOn: false, by: 'supply',
    })
    check('🔴 kill switch 가 꺼져 있으면 가장 안전한 단계로 간다(env 경로 없음)',
      !off.ok && off.fallback === 'safest')
  }

  console.log('\n⑦ 🔴 만든 행은 덮이지 않는다 (adapter 에 갱신 경로가 없다)')
  {
    await wipe()
    const first = decision({ release: 'd5' })
    await createStageDecision(prisma, first)
    const second = decision({
      release: 'd3',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV, target: 'd3' },
    })
    check('🔴 🔴 **두 번째 create 는 conflict — 덮어쓰지 않는다**',
      await createStageDecision(prisma, second) === 'conflict')
    const got = await readStageDecision(prisma, DATE)
    check('🔴 처음 값이 그대로다',
      got.found && got.result.ok && got.result.decision.release === 'd5',
      got.found && got.result.ok ? got.result.decision.release : '')
    const raw = await prisma.stageDecision.findUnique({ where: { kstDate: DATE } })
    check('🔴 rowToValidatorInput 이 그 행을 그대로 옮긴다',
      raw !== null && validateStoredDecision({
        row: rowToValidatorInput(raw), expectKstDate: DATE,
      }).ok)
  }

  console.log('\n⑧ 🔴 증명일 기회 — 실제 DB(자동 READY 수) + 공급 산출 파일(묶음 · 기회 스냅샷) → readPreflightFacts')
  {
    /**
     * 🔴 (2026-10-01 Lane B) 운영 반례 모양: 수율 = 자동 READY 3 ÷ 묶음 원천 30 = 0.1 · d3 슬롯 3.
     *    앞판은 원천을 슬롯에 먼저 짝지어(3) 수율을 곱했다 — floor(3 × 0.1) = 0. 원천이 40건이어도 0 이었다.
     */
    const site = 'fixture:preflight'
    const wipePf = async (): Promise<void> => {
      await prisma.originalPostApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: 'pf-' } } })
      await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: site } })
    }
    await wipePf()
    // 자동 READY 3건 — 증거일(09-30 KST) 창 안 결정 시각 · 미발행 · 재고 밖(DECLINED)
    for (let k = 0; k < 3; k += 1) {
      const raw = await prisma.microSeedRawContent.create({
        data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/pf${k}`, sourceArticleId: `pf-${k}`,
          sourceCapturedAt: new Date('2026-09-30T01:00:00Z'), rawTitle: `원문 ${k}`, rawBody: `원문 본문 ${k}` },
        select: { id: true },
      })
      await prisma.originalPostApprovalQueue.create({
        data: { sourceRawContentId: raw.id, status: 'DECLINED', draftTitle: `초안 ${k}`, draftBody: `본문 ${k}`,
          gateVerdict: 'PASS', gateResults: {}, promptVersion: 'pf', model: 'pf',
          decidedBy: AUTO_DECIDER, decidedAt: new Date('2026-09-30T03:00:00Z'), dedupKey: `pf-${k}` },
      })
    }
    const now = new Date('2026-10-01T07:00:00+09:00')
    const dir = mkdtempSync(join(tmpdir(), 'pf-opp-'))
    // 묶음 3개 × 10 원천 = 30 (창 안 회차)
    for (const runId of ['20260928-031500', '20260929-031500', '20260930-031500']) {
      writeFileSync(join(dir, worksetFileName(runId)), JSON.stringify({
        kind: WORKSET_KIND, version: WORKSET_VERSION, runId, takenAt: `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T03:15:00.000Z`,
        limit: 10, sources: Array.from({ length: 10 }, (_, i) => ({ sourceSite: site, sourceArticleId: `${runId}-${i}` })),
      }))
    }
    const iso = (ms: number): string => new Date(ms).toISOString()
    const evidence = (i: number): unknown => buildSourceEvidence({
      postedAt: iso(now.getTime() - 2 * 3_600_000), capturedAt: iso(now.getTime() - 3_600_000),
      sourceSite: site, sourceArticleId: `opp-${i}`, dedupKey: `${site}|opp-${i}`,
      response: { comments: 3, views: 100, observedAt: iso(now.getTime() - 3_600_000) },
      sourceStats: { basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: site, bucket: '<3h', n: 5,
        commentsPct: 0.5, viewsPct: 0.5, windowFrom: iso(now.getTime() - 73 * 3_600_000), windowTo: iso(now.getTime() - 3_600_000) },
    })
    const snapshot = (n: number): void => {
      const runId = '20260930-131500'
      writeFileSync(join(dir, opportunitiesFileName(runId)), JSON.stringify({
        kind: OPPORTUNITY_KIND, version: OPPORTUNITY_VERSION, runId, takenAt: '2026-09-30T13:15:00.000Z',
        slotAt: slotTimesOn('2026-10-01', profileOf('d3'))[0]!.toISOString(), evidence: Array.from({ length: n }, (_, i) => evidence(i)),
      }))
    }
    const facts = async (): Promise<Awaited<ReturnType<typeof readPreflightFacts>>> => readPreflightFacts(prisma, {
      loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
      autoOpen: { open: false, reasons: [] }, proofSlots: slotTimesOn('2026-10-01', profileOf('d3')),
      caps: releaseCapsOf(profileOf('d3')), evidenceDate: '2026-09-30', env: {}, dataDir: dir, now,
      runnerHealth: 'ok', contractValidPersonas: async () => 30,
    })
    try {
      const none = await facts()
      check('🔴 기회 스냅샷 파일이 없으면 원천 기회 0 — 운영 2026-10-01 모양(공급 러너가 스냅샷을 쓰지 않는 판)',
        none.facts.slotValidOpportunities === 0 && none.detail.opportunitySnapshotAt === null, JSON.stringify(none.detail))
      check('🔴 수율 = 실제 DB 자동 READY 3 ÷ 묶음 원천 30 = 0.1 (원천 기회 할인용 raw 수율)',
        none.detail.readyPerSource === 0.1, String(none.detail.readyPerSource))
      const c0 = none.facts.readyCohort
      check('🔴 같은 행이 cohort 로 — 원천 30 · 공개 0 · 손실(DECLINED) 3 · 대기 0',
        c0 !== null && c0.sources === 30 && c0.published === 0 && c0.lost === 3 && c0.pending === 0, JSON.stringify(c0))
      const v0 = judgeNextPreflight('d3', none.facts, RUNNER_GRID)
      check('🔴 🔴 **공개 0 · 손실 3 → READY_REQUIREMENT_UNKNOWN (영구 불능 FAIL 아님) · 공급 비용 UNKNOWN**',
        v0.codes.includes('READY_REQUIREMENT_UNKNOWN') && !v0.codes.includes('THROUGHPUT_SHORT')
        && v0.codes.includes('SUPPLY_COST_UNKNOWN') && !v0.codes.includes('SUPPLY_COST_SHORT'), JSON.stringify(v0))
      snapshot(40)
      const r40 = await facts()
      check('🔴 🔴 **원천 40 · 수율 0.1 → 기대 READY 4 → d3 슬롯 3 전부 (앞판 floor(3×0.1) = 0)**',
        r40.facts.slotValidOpportunities === 3 && r40.detail.sourceValid === 40 && r40.detail.sourceExpected === 3,
        JSON.stringify(r40.detail))
      snapshot(30)
      const r30 = await facts()
      check('🔴 🔴 **실제 가용 원천 30 · 수율 0.1 → d3 기회 3**',
        r30.facts.slotValidOpportunities === 3 && r30.detail.sourceValid === 30 && r30.detail.sourceExpected === 3,
        JSON.stringify(r30.detail))
      snapshot(5)
      const r5 = await facts()
      check('🔴 과대평가 금지 — 원천 5 · 수율 0.1 → floor(0.5) = 0',
        r5.facts.slotValidOpportunities === 0 && r5.detail.sourceValid === 5, JSON.stringify(r5.detail))
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await wipePf()
    }
  }

  console.log('\n⑨ 🔴 READY cohort — 결말 5종 · 창 경계 · 오래된/최근 대기 · 사람 결정 제외 (실제 DB groupBy)')
  {
    const site = 'fixture:cohort'
    const wipeC = async (): Promise<void> => {
      await prisma.originalPostApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: 'pfc-' } } })
      await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: site } })
    }
    await wipeC()
    /**
     * 증거일 2026-09-30 → 창 = KST 09-28 00:00 ~ 10-01 00:00 = UTC [09-27T15:00Z, 09-30T15:00Z).
     *    창 안: PUBLISHED 2 · EXPIRED 1 · DECLINED 1 · EDITED 1 · APPROVED(창 시작 정각) 1 · APPROVED(창 끝 1초 전 · 최근) 1
     *    창 밖: APPROVED 창 시작 1초 전(오래된 대기) · APPROVED 창 끝 정각 · 사람 결정 PUBLISHED
     */
    const rows: { k: string; status: 'PUBLISHED' | 'EXPIRED' | 'DECLINED' | 'APPROVED' | 'EDITED'; at: string; by?: string }[] = [
      { k: 'pub1', status: 'PUBLISHED', at: '2026-09-28T03:00:00Z' },
      { k: 'pub2', status: 'PUBLISHED', at: '2026-09-29T03:00:00Z' },
      { k: 'exp', status: 'EXPIRED', at: '2026-09-29T05:00:00Z' },
      { k: 'dec', status: 'DECLINED', at: '2026-09-30T01:00:00Z' },
      { k: 'edit', status: 'EDITED', at: '2026-09-30T02:00:00Z' },
      { k: 'start', status: 'APPROVED', at: '2026-09-27T15:00:00Z' },
      { k: 'recent', status: 'APPROVED', at: '2026-09-30T14:59:59Z' },
      { k: 'old', status: 'APPROVED', at: '2026-09-27T14:59:59Z' },
      { k: 'end', status: 'APPROVED', at: '2026-09-30T15:00:00Z' },
      { k: 'human', status: 'PUBLISHED', at: '2026-09-29T03:00:00Z', by: 'founder' },
    ]
    for (const r of rows) {
      const raw = await prisma.microSeedRawContent.create({
        data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/${r.k}`, sourceArticleId: `pfc-${r.k}`,
          sourceCapturedAt: new Date('2026-09-27T01:00:00Z'), rawTitle: `원문 ${r.k}`, rawBody: `원문 본문 ${r.k}` },
        select: { id: true },
      })
      await prisma.originalPostApprovalQueue.create({
        data: { sourceRawContentId: raw.id, status: r.status, draftTitle: `초안 ${r.k}`, draftBody: `본문 ${r.k}`,
          ...(r.status === 'EDITED' ? { editedTitle: `수정 ${r.k}`, editedBody: `수정 본문 ${r.k}` } : {}),
          gateVerdict: 'PASS', gateResults: {}, promptVersion: 'pfc', model: 'pfc',
          decidedBy: r.by ?? AUTO_DECIDER, decidedAt: new Date(r.at), dedupKey: `pfc-${r.k}` },
      })
    }
    const now = new Date('2026-10-01T07:00:00+09:00')
    const dir = mkdtempSync(join(tmpdir(), 'pfc-'))
    for (const runId of ['20260928-031500', '20260929-031500', '20260930-031500']) {
      writeFileSync(join(dir, worksetFileName(runId)), JSON.stringify({
        kind: WORKSET_KIND, version: WORKSET_VERSION, runId, takenAt: `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T03:15:00.000Z`,
        limit: 10, sources: Array.from({ length: 10 }, (_, i) => ({ sourceSite: site, sourceArticleId: `${runId}-${i}` })),
      }))
    }
    try {
      const r = await readPreflightFacts(prisma, {
        loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
        autoOpen: { open: false, reasons: [] }, proofSlots: slotTimesOn('2026-10-01', profileOf('d5')),
        caps: releaseCapsOf(profileOf('d5')), evidenceDate: '2026-09-30', env: {}, dataDir: dir, now,
        runnerHealth: 'ok', contractValidPersonas: async () => 30,
      })
      const c = r.facts.readyCohort
      check('🔴 🔴 **cohort = 공개 2 · 손실 2(EXPIRED · DECLINED) · 대기 3(EDITED · 창 시작 정각 · 최근) · 원천 30**',
        c !== null && c.published === 2 && c.lost === 2 && c.pending === 3 && c.sources === 30, JSON.stringify(c))
      check('🔴 창 시작 1초 전 오래된 대기 · 창 끝 정각 · 사람 결정 행은 cohort 밖 — raw READY 7',
        r.detail.readyCount === 7, String(r.detail.readyCount))
      if (c !== null) {
        const d3 = judgeNextPreflight('d3', { ...r.facts, readyCohort: { ...c, supplyUsd: 0.07 } }, RUNNER_GRID)
        check('🔴 d3 — 대기를 전부 손실로 봐도(필요 11) 같은 cohort 용량 14 가 채운다 → 처리량 확정',
          d3.counts.readyNeededMax === 11 && d3.counts.readyCapacity === 14
          && !d3.codes.includes('THROUGHPUT_SHORT') && !d3.codes.includes('READY_REQUIREMENT_UNKNOWN'), JSON.stringify(d3.counts))
        const d5 = judgeNextPreflight('d5', { ...r.facts, readyCohort: { ...c, supplyUsd: 0.07 } }, RUNNER_GRID)
        check('🔴 🔴 **d5 — 대기 3 의 결말에 따라 필요 7~18 · 용량 14 → READY_REQUIREMENT_UNKNOWN (PASS 로 확정하지 않는다)**',
          d5.counts.readyNeededMin === 7 && d5.counts.readyNeededMax === 18
          && d5.codes.includes('READY_REQUIREMENT_UNKNOWN') && d5.verdict !== 'PASS', JSON.stringify(d5.counts))
        check('🔴 대기가 있으면 공개 1건 단가를 내지 않는다(raw 단가로 대신하지 않는다)',
          Math.abs((d5.counts.rawReadyUsd ?? 0) - 0.01) < 1e-12 && !('publicPostUsd' in d5.counts), JSON.stringify(d5.counts))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await wipeC()
    }
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()
