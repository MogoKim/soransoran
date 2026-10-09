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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPreflightFacts, readReadyCohort } from './lib/stage-preflight-facts.mjs'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { buildSourceEvidence, SOURCE_STATS_METHOD } from '../src/lib/source-slot-release'
import {
  OPPORTUNITY_KIND, OPPORTUNITY_VERSION, WORKSET_KIND, WORKSET_VERSION, WORKSET_VERSION_JIT, SUPPLY_JIT_CONTRACT, SUPPLY_INTENT_KEY,
  opportunitiesFileName, worksetFileName,
} from '../src/lib/supply-workset'
import { articleIdHashOf } from '../src/lib/source-slot-release'

/** 🔴 JIT 계약 묶음(workset-v3) — 원천마다 예정 슬롯 · 슬롯 시점 나이 필수 */
/** 🔴 JIT 계약 묶음(workset-v3) — 원천마다 예정 슬롯 · 슬롯 시점 나이 필수. `ids` 는 큐 행과 연결되는 원천(앞쪽), 나머지는 채움 */
const wsV3 = (runId: string, site: string, n: number, ids: readonly string[] = []): string => JSON.stringify({
  kind: WORKSET_KIND, version: WORKSET_VERSION_JIT, contract: SUPPLY_JIT_CONTRACT, runId,
  takenAt: `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T03:15:00.000Z`, limit: 10,
  sources: Array.from({ length: n }, (_, i) => ({
    sourceSite: site, sourceArticleId: ids[i] ?? `${runId}-${i}`, slotAt: '2026-10-01T00:00:00.000Z', ageAtSlotH: 5,
  })),
})
/** 🔴 큐 행 공급 의도 — 적재기가 묶음에서 옮겨 적는 것과 같은 모양 */
const withIntent = (gate: unknown, site: string, id: string): Record<string, unknown> => ({
  ...(gate !== null && typeof gate === 'object' ? gate as Record<string, unknown> : {}),
  [SUPPLY_INTENT_KEY]: {
    contract: SUPPLY_JIT_CONTRACT, runId: '20260929-031500', sourceHash: articleIdHashOf(site, id),
    intendedSlotAt: '2026-10-01T00:00:00.000Z', ageAtSlotH: 5,
  },
})
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { profileOf, releaseCapsOf } from '../src/lib/scale-profile'
import { judgeNextPreflight, slotTimesOn } from '../src/lib/stage-ladder-generic'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { ledgerDirForHome } from './lib/llm-ledger-store.mjs'
import type { LedgerEntry } from '../src/lib/llm-ledger'

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
    // 자동 READY 3건 — 증거일(09-30 KST) 창 안 결정 시각 · 공개로 끝남(PUBLISHED · 재고 밖) → 결말 수율 3 ÷ 30
    for (let k = 0; k < 3; k += 1) {
      const raw = await prisma.microSeedRawContent.create({
        data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/pf${k}`, sourceArticleId: `pf-${k}`,
          sourceCapturedAt: new Date('2026-09-30T01:00:00Z'), rawTitle: `원문 ${k}`, rawBody: `원문 본문 ${k}` },
        select: { id: true },
      })
      await prisma.originalPostApprovalQueue.create({
        data: { sourceRawContentId: raw.id, status: 'PUBLISHED', draftTitle: `초안 ${k}`, draftBody: `본문 ${k}`,
          // 🔴 현재 계약 표본 — 의도 · 원문 증거 해시 · 그 회차 v3 묶음이 정확히 연결된다
          gateResults: withIntent({ sourceEvidence: buildSourceEvidence({ sourceSite: site, sourceArticleId: `pf-${k}` }) }, site, `pf-${k}`) as Prisma.InputJsonValue,
          gateVerdict: 'PASS', promptVersion: 'pf', model: 'pf',
          decidedBy: AUTO_DECIDER, decidedAt: new Date('2026-09-30T03:00:00Z'), dedupKey: `pf-${k}` },
      })
    }
    const now = new Date('2026-10-01T07:00:00+09:00')
    const dir = mkdtempSync(join(tmpdir(), 'pf-opp-'))
    // JIT 묶음 3개 × 10 원천 = 30 (창 안 회차 · workset-v3)
    for (const runId of ['20260928-031500', '20260929-031500', '20260930-031500']) {
      writeFileSync(join(dir, worksetFileName(runId)), wsV3(runId, site, 10, runId === '20260929-031500' ? ['pf-0', 'pf-1', 'pf-2'] : []))
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
      const y0 = none.detail.yieldBounds as { low: number; high: number } | null
      check('🔴 결말 수율 = 실제 DB 공개 3 ÷ 묶음 원천 30 = 0.1 (구간 low = high · 대기 0)',
        y0 !== null && y0.low === 0.1 && y0.high === 0.1, JSON.stringify(y0))
      const c0 = none.facts.readyCohort
      check('🔴 같은 행이 cohort 로 — 원천 30 · 공개 3 · 손실 0 · 예정 0 · 모름 0',
        c0 !== null && c0.sources === 30 && c0.published === 3 && c0.lost === 0 && c0.scheduled === 0 && c0.unknown === 0,
        JSON.stringify(c0))
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
      // 🔴 같은 READY 3건이 만료로 끝났으면 결말 수율 0 — raw 수율(READY 3 ÷ 30)이었다면 여전히 기회 3 이었다
      await prisma.originalPostApprovalQueue.updateMany({ where: { dedupKey: { startsWith: 'pf-' } }, data: { status: 'EXPIRED' } })
      snapshot(30)
      const rLost = await facts()
      check('🔴 🔴 **원천 기회 할인은 결말 수율 — 같은 READY 3 이 만료로 끝나면 원천 30 → 기대 0 · 기회 0 (raw 수율이면 3)**',
        rLost.facts.slotValidOpportunities === 0 && rLost.detail.sourceExpected === 0 && rLost.detail.sourceValid === 30,
        JSON.stringify(rLost.detail))
      // 🔴 legacy-only — 같은 행에서 공급 의도를 지우고 옛 판(v2) 묶음만 둔다 → 근거 없음 = UNKNOWN (FAIL 아님)
      const legacyDir = mkdtempSync(join(tmpdir(), 'pf-legacy-'))
      try {
        for (const runId of ['20260928-031500', '20260929-031500', '20260930-031500']) {
          writeFileSync(join(legacyDir, worksetFileName(runId)), JSON.stringify({
            kind: WORKSET_KIND, version: WORKSET_VERSION, runId, takenAt: `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T03:15:00.000Z`,
            limit: 10, sources: Array.from({ length: 10 }, (_, i) => ({ sourceSite: site, sourceArticleId: `${runId}-${i}` })),
          }))
        }
        await prisma.originalPostApprovalQueue.updateMany({ where: { dedupKey: { startsWith: 'pf-' } }, data: { gateResults: {} } })
        const leg = await readPreflightFacts(prisma, {
          loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
          autoOpen: { open: false, reasons: [] }, proofSlots: slotTimesOn('2026-10-01', profileOf('d3')),
          caps: releaseCapsOf(profileOf('d3')), evidenceDate: '2026-09-30', env: {}, dataDir: legacyDir, now,
          runnerHealth: 'ok', contractValidPersonas: async () => 30,
        })
        const lv = judgeNextPreflight('d3', leg.facts, RUNNER_GRID)
        check('🔴 🔴 **legacy-only(의도 없는 READY 3 · v2 묶음) → cohort 없음 · THROUGHPUT_UNKNOWN · SUPPLY_COST_UNKNOWN (FAIL 아님)**',
          leg.facts.readyCohort === null && leg.detail.legacyExcluded === 3 && lv.codes.includes('THROUGHPUT_UNKNOWN')
          && lv.codes.includes('SUPPLY_COST_UNKNOWN') && !lv.codes.includes('THROUGHPUT_SHORT') && !lv.codes.includes('SUPPLY_COST_SHORT'),
          JSON.stringify({ detail: leg.detail, codes: lv.codes }))
      } finally { rmSync(legacyDir, { recursive: true, force: true }) }
      // 🔴 손상된 최신 기회 스냅샷 · 묶음 → 조용히 건너뛰지 않고 모른다
      writeFileSync(join(dir, opportunitiesFileName('20260930-231500')), '{ 손상')
      const rBadSnap = await facts()
      check('🔴 최신 기회 스냅샷 손상 → 증명일 기회 UNKNOWN(null) — 더 오래된 스냅샷으로 내려가지 않는다',
        rBadSnap.facts.slotValidOpportunities === null, String(rBadSnap.facts.slotValidOpportunities))
      writeFileSync(join(dir, worksetFileName('20260929-091500')), '{ 손상')
      const rBadWs = await facts()
      check('🔴 창 안 묶음 하나 손상 → 원천 수 · cohort UNKNOWN(null) — 손상 파일을 표본에서 빼지 않는다',
        rBadWs.detail.worksetSources === null && rBadWs.facts.readyCohort === null, JSON.stringify(rBadWs.detail))
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await wipePf()
    }
  }

  console.log('\n⑨ 🔴 READY cohort — 결말 5종 · 대기 3분류(정본 판정) · 창 경계 · 사람 결정 제외 (실제 DB)')
  {
    const site = 'fixture:cohort'
    const wipeC = async (): Promise<void> => {
      await prisma.originalPostApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: 'pfc-' } } })
      await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: site } })
    }
    await wipeC()
    const now = new Date('2026-10-01T07:00:00+09:00')
    const proofSlots = slotTimesOn('2026-10-01', profileOf('d5'))
    const first = proofSlots[0]!
    const iso = (ms: number): string => new Date(ms).toISOString()
    /** 🔴 정본 판정이 읽는 증거 기록 — 게시 시각만 바꾼다(반응 · 표본 · 참여 동력은 있다) */
    const evAt = (k: string, postedMs: number): unknown => ({
      sourceEvidence: buildSourceEvidence({
        postedAt: iso(postedMs), capturedAt: iso(postedMs + 30 * 60_000),
        sourceSite: site, sourceArticleId: `pfc-${k}`, dedupKey: `${site}|pfc-${k}`,
        response: { comments: 3, views: 100, observedAt: iso(postedMs + 30 * 60_000) },
        sourceStats: { basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: site, bucket: '<3h', n: 5,
          commentsPct: 0.5, viewsPct: 0.5, windowFrom: iso(postedMs - 72 * 3_600_000), windowTo: iso(postedMs + 30 * 60_000) },
        participationDriver: '공감',
      }),
    })
    const fresh = now.getTime() - 2 * 3_600_000
    /**
     * 증거일 2026-09-30 → 창 = UTC [09-27T15:00Z, 09-30T15:00Z). 지금 10-01 07:00 KST · d5 첫 슬롯 이후 판정.
     *    창 안: PUBLISHED 2 · EXPIRED 1 · DECLINED 1 ·
     *      대기 — 증거 없음(EDITED) → 손실 · 원문 80h(오래됨) → 손실 · 지금은 72h 미만이지만 첫 슬롯에서 72h 초과 → 손실 ·
     *             신선(창 시작 정각) · 신선(창 끝 1초 전) → 짝 없음 = 모름(자동 READY 닫힘)
     *    창 밖: 창 시작 1초 전 대기 · 창 끝 정각 대기 · 사람 결정 PUBLISHED
     */
    const rows: { k: string; status: 'PUBLISHED' | 'EXPIRED' | 'DECLINED' | 'APPROVED' | 'EDITED'; at: string; gate: unknown; by?: string }[] = [
      { k: 'pub1', status: 'PUBLISHED', at: '2026-09-28T03:00:00Z', gate: evAt('pub1', fresh) },
      { k: 'pub2', status: 'PUBLISHED', at: '2026-09-29T03:00:00Z', gate: evAt('pub2', fresh) },
      { k: 'exp', status: 'EXPIRED', at: '2026-09-29T05:00:00Z', gate: evAt('exp', fresh) },
      { k: 'dec', status: 'DECLINED', at: '2026-09-30T01:00:00Z', gate: evAt('dec', fresh) },
      { k: 'noev', status: 'EDITED', at: '2026-09-30T02:00:00Z', gate: {} },
      { k: 'stale', status: 'APPROVED', at: '2026-09-29T02:00:00Z', gate: evAt('stale', now.getTime() - 80 * 3_600_000) },
      { k: 'soon', status: 'APPROVED', at: '2026-09-30T03:00:00Z', gate: evAt('soon', first.getTime() - 72 * 3_600_000 - 60_000) },
      { k: 'start', status: 'APPROVED', at: '2026-09-27T15:00:00Z', gate: evAt('start', fresh) },
      { k: 'recent', status: 'APPROVED', at: '2026-09-30T14:59:59Z', gate: evAt('recent', fresh) },
      { k: 'old', status: 'APPROVED', at: '2026-09-27T14:59:59Z', gate: evAt('old', fresh) },
      { k: 'end', status: 'APPROVED', at: '2026-09-30T15:00:00Z', gate: evAt('end', fresh) },
      { k: 'human', status: 'PUBLISHED', at: '2026-09-29T03:00:00Z', gate: {}, by: 'founder' },
      { k: 'legacy', status: 'EXPIRED', at: '2026-09-29T04:00:00Z', gate: {} },
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
          gateVerdict: 'PASS', promptVersion: 'pfc', model: 'pfc',
          // 🔴 legacy 행만 공급 의도가 없다 — 근거로 세지 않는다
          // 🔴 legacy · 증거 없는 옛 행만 공급 의도가 없다 — 근거로 세지 않는다(증거 없는 행이 계약을 주장하면 cohort 가 모름이 된다)
          gateResults: (r.k === 'legacy' || r.k === 'noev' ? r.gate : withIntent(r.gate, site, `pfc-${r.k}`)) as Prisma.InputJsonValue,
          decidedBy: r.by ?? AUTO_DECIDER, decidedAt: new Date(r.at), dedupKey: `pfc-${r.k}` },
      })
    }
    const dir = mkdtempSync(join(tmpdir(), 'pfc-'))
    for (const runId of ['20260928-031500', '20260929-031500', '20260930-031500']) {
      writeFileSync(join(dir, worksetFileName(runId)), wsV3(runId, site, 10, runId !== '20260929-031500' ? []
        : ['pub1', 'pub2', 'exp', 'dec', 'stale', 'soon', 'start', 'recent', 'old', 'end'].map((k) => `pfc-${k}`)))
    }
    // 🔴 같은 창의 옛 판(v2) 묶음 — 손상이 아니라 legacy: 세지 않는다(원천 30 그대로)
    writeFileSync(join(dir, worksetFileName('20260929-091500')), JSON.stringify({
      kind: WORKSET_KIND, version: WORKSET_VERSION, runId: '20260929-091500', takenAt: '2026-09-29T09:15:00.000Z',
      limit: 10, sources: Array.from({ length: 10 }, (_, i) => ({ sourceSite: site, sourceArticleId: `legacy-${i}` })),
    }))
    try {
      check('🔴 fixture 전제 — "곧 만료" 행은 지금은 72h 미만 · d5 첫 슬롯에서는 72h 이상',
        now.getTime() - (first.getTime() - 72 * 3_600_000 - 60_000) < 72 * 3_600_000 && first.getTime() > now.getTime() + 60_000)
      const r = await readPreflightFacts(prisma, {
        loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
        autoOpen: { open: false, reasons: [] }, proofSlots,
        caps: releaseCapsOf(profileOf('d5')), evidenceDate: '2026-09-30', env: {}, dataDir: dir, now,
        runnerHealth: 'ok', contractValidPersonas: async () => 30,
      })
      const c = r.facts.readyCohort
      // 🔴 (2026-10-09 P0) cohort 소속은 회차다 — decidedAt 이 창 시작 1초 전(old) · 창 끝 정각(end) 이어도 회차가 창 안이면 포함
      check('🔴 🔴 **F 완전 연결 cohort = 공개 2 · 손실 4(EXPIRED · DECLINED · 80h · 슬롯 전 만료) · 예정 0 · 모름 4(start · recent · old · end) · 원천 30**',
        c !== null && c.published === 2 && c.lost === 4 && c.scheduled === 0 && c.unknown === 4 && c.sources === 30
        && (r.detail.intentMismatches as unknown[]).length === 0, JSON.stringify({ c, m: r.detail.intentMismatches }))
      check('🔴 🔴 **decidedAt 이 아니라 회차가 소속을 정한다 — 창 밖 decidedAt(old · end)도 회차가 창 안이라 포함 · 사람 결정 · 의도 없는 legacy 2행은 밖 — raw READY 10 · legacy 2**',
        r.detail.readyCount === 10 && r.detail.legacyExcluded === 2, JSON.stringify(r.detail))
      const y = r.detail.yieldBounds as { low: number; high: number } | null
      check('🔴 결말 수율 구간 = 공개 2 ÷ 30 ~ (2 + 모름 4) ÷ 30', y !== null && y.low === 2 / 30 && y.high === 6 / 30, JSON.stringify(y))
      if (c !== null) {
        const d3 = judgeNextPreflight('d3', { ...r.facts, readyCohort: { ...c, usdPerSlotValidResult: 0.01 } }, RUNNER_GRID)
        check('🔴 d3 — 모르는 대기를 전부 손실로 봐도(필요 15) 같은 cohort 용량 20 이 채운다 → 처리량 확정',
          d3.counts.readyNeededMax === 15 && d3.counts.readyCapacity === 20
          && !d3.codes.includes('THROUGHPUT_SHORT') && !d3.codes.includes('READY_REQUIREMENT_UNKNOWN'), JSON.stringify(d3.counts))
        const d5 = judgeNextPreflight('d5', { ...r.facts, readyCohort: { ...c, usdPerSlotValidResult: 0.01 } }, RUNNER_GRID)
        check('🔴 🔴 **d5 — 모르는 대기 4 의 결말에 따라 필요 9~25 · 용량 20 → READY_REQUIREMENT_UNKNOWN (PASS 로 확정하지 않는다)**',
          d5.counts.readyNeededMin === 9 && d5.counts.readyNeededMax === 25
          && d5.codes.includes('READY_REQUIREMENT_UNKNOWN') && d5.verdict !== 'PASS', JSON.stringify(d5.counts))
        check('🔴 공급 비용 = 목표 5 × 결과당 $0.01 — raw READY 단가 · 공개 단가 칸 없음',
          Math.abs((d5.counts.supplyDailyUsdNeeded ?? 0) - 0.05) < 1e-12
          && !('rawReadyUsd' in d5.counts) && !('publicPostUsd' in d5.counts), JSON.stringify(d5.counts))
        check('🔴 실제 비용 귀속은 현재 계약 정산이 없다(호스트 장부는 legacy 뿐) → 결과당 단가 모름(null) → 판정 비용 UNKNOWN',
          c.usdPerSlotValidResult === null && judgeNextPreflight('d5', r.facts, RUNNER_GRID).codes.includes('SUPPLY_COST_UNKNOWN'))
      }
      const factsAgain = async (): Promise<Awaited<ReturnType<typeof readPreflightFacts>>> => readPreflightFacts(prisma, {
        loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
        autoOpen: { open: false, reasons: [] }, proofSlots,
        caps: releaseCapsOf(profileOf('d5')), evidenceDate: '2026-09-30', env: {}, dataDir: dir, now,
        runnerHealth: 'ok', contractValidPersonas: async () => 30,
      })
      /**
       * 🔴 **cohort 경계 — 창 밖 회차의 행은 이 cohort 가 아니다** (2026-10-04 P0-2 · 2026-10-09 P0 회차 시계).
       *    창 = UTC [09-27T15:00:00Z, 09-30T15:00:00Z). 같은 큐 행(창 안 decidedAt)의 의도를 창 시작 1초 전 회차로 옮기면
       *    분자 · 분모 · 비용 어디에도 넣지 않는다(제외) — 앞판처럼 cohort 전체를 모름으로 닫지 않는다.
       *    같은 행을 창 시작 정각 회차로 옮기면 그 묶음 원천 1 과 함께 들어온다.
       */
      const rec = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { dedupKey: 'pfc-recent' }, select: { id: true, gateResults: true } })
      const g0 = rec.gateResults as Record<string, Record<string, unknown>>
      const moveTo = async (runId: string): Promise<void> => {
        writeFileSync(join(dir, worksetFileName(runId)), wsV3(runId, site, 1, ['pfc-recent']))
        await prisma.originalPostApprovalQueue.update({
          where: { id: rec.id }, data: { gateResults: { ...g0, [SUPPLY_INTENT_KEY]: { ...g0[SUPPLY_INTENT_KEY], runId } } as Prisma.InputJsonValue },
        })
      }
      await moveTo('20260927-145959')
      const outside = await factsAgain()
      const ov = judgeNextPreflight('d5', outside.facts, RUNNER_GRID)
      const oc = outside.facts.readyCohort
      check('🔴 🔴 **창 밖 회차 — 묶음 runAt 창 시작 1초 전 · 큐 decidedAt 창 안 → 그 행은 cohort 밖(제외) · 불일치 0 · 모름 3 · 원천 30 그대로 · 처리량 판정 가능**',
        oc !== null && oc.unknown === 3 && oc.published === 2 && oc.lost === 4 && oc.sources === 30
        && (outside.detail.intentMismatches as unknown[]).length === 0 && outside.detail.readyCount === 9 && !ov.codes.includes('THROUGHPUT_UNKNOWN'),
        JSON.stringify({ oc, m: outside.detail.intentMismatches, codes: ov.codes }))
      await moveTo('20260927-150000')
      const inside = await factsAgain()
      const ic = inside.facts.readyCohort
      check('🔴 🔴 **같은 행의 묶음 runAt 이 창 시작 정각(창 안) → 정상 계산 — 공개 2 · 손실 4 · 모름 4 · 원천 31(그 묶음 1 포함)**',
        ic !== null && ic.published === 2 && ic.lost === 4 && ic.unknown === 4 && ic.sources === 31
        && (inside.detail.intentMismatches as unknown[]).length === 0, JSON.stringify({ ic, m: inside.detail.intentMismatches }))
      await prisma.originalPostApprovalQueue.update({ where: { id: rec.id }, data: { gateResults: g0 as Prisma.InputJsonValue } })
      // 🔴 E — 큐 의도 하나가 그 회차 묶음과 나이 한 칸만 달라도 cohort 전체가 모름(legacy 로 빼지 않는다)
      const one = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { dedupKey: 'pfc-start' }, select: { id: true, gateResults: true } })
      const g = one.gateResults as Record<string, Record<string, unknown>>
      await prisma.originalPostApprovalQueue.update({
        where: { id: one.id }, data: { gateResults: { ...g, [SUPPLY_INTENT_KEY]: { ...g[SUPPLY_INTENT_KEY], ageAtSlotH: 6 } } as Prisma.InputJsonValue },
      })
      const bad = await factsAgain()
      const bv = judgeNextPreflight('d5', bad.facts, RUNNER_GRID)
      check('🔴 🔴 **E 큐 의도 ageAtSlotH ≠ v3 묶음 → AGE_MISMATCH · cohort 없음 · THROUGHPUT_UNKNOWN · SUPPLY_COST_UNKNOWN**',
        bad.facts.readyCohort === null && JSON.stringify(bad.detail.intentMismatches) === JSON.stringify(['AGE_MISMATCH'])
        && bv.codes.includes('THROUGHPUT_UNKNOWN') && bv.codes.includes('SUPPLY_COST_UNKNOWN') && bad.detail.legacyExcluded === 2,
        JSON.stringify({ m: bad.detail.intentMismatches, codes: bv.codes }))
      await prisma.originalPostApprovalQueue.update({
        where: { id: one.id },
        data: { gateResults: { ...g, sourceEvidence: buildSourceEvidence({ sourceSite: site, sourceArticleId: 'pfc-other' }) } as Prisma.InputJsonValue },
      })
      const badEv = await factsAgain()
      check('🔴 E 큐 원문 증거 해시 ≠ 의도 원천 해시 → EVIDENCE_HASH_MISMATCH · cohort 없음',
        badEv.facts.readyCohort === null && JSON.stringify(badEv.detail.intentMismatches) === JSON.stringify(['EVIDENCE_HASH_MISMATCH']))
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await wipeC()
    }
  }

  console.log('\n⑩ 🔴 2026-10-08 22:15 사건 재생 — 회차 시계 · 도장 전 행 · 예약 상한 비용 · D10 은 여전히 BLOCK (2026-10-09 P0)')
  {
    /**
     * 🔴 운영 실측 모양(보조 맥북 · 정본 판독기로 재계산한 값) — 증거일 2026-10-08 · 창 KST 10-06~08 · 판정 10-09 07:00.
     *    창 안 workset 회차 11개(UTC id) · 원천 101 · 그 회차들이 만든 READY 20 —
     *      도장된 16(공개 8 · 만료 2 · 대기 6) + **22:15 회차(20261008-131506) 4건은 22:16 적재 · 08:00 자동 도장**(07:00 엔 도장 전).
     *    앞판(분자 = decidedAt 창)은 16 ÷ 101 → 공급 능력 9. 회차 시계면 20 ÷ 101 → 11. 필요 12 → 여전히 THROUGHPUT_SHORT.
     *    장부 — 사용량 미상 2건(예약 $0.008652 · $0.0085926 · 운영 실측값) → 예약 상한으로 센다.
     */
    const site = 'fixture:p0-2215'
    const RUNS: readonly [string, number, number][] = [
      ['20261006-231506', 10, 2], ['20261007-031505', 10, 1], ['20261007-051506', 10, 2], ['20261007-121506', 7, 0],
      ['20261007-131506', 8, 1], ['20261007-231502', 7, 0], ['20261008-031505', 9, 2], ['20261008-051506', 10, 4],
      ['20261008-081504', 10, 3], ['20261008-121502', 10, 1], ['20261008-131506', 10, 4],
    ]
    const LATE = '20261008-131506'
    const OUT_BEFORE = '20261005-131505'
    const OUT_AFTER = '20261008-231504'
    const now = new Date('2026-10-09T07:00:00+09:00')
    const windowFrom = new Date('2026-10-05T15:00:00Z')
    const windowTo = new Date('2026-10-08T15:00:00Z')
    const iso = (ms: number): string => new Date(ms).toISOString()
    const fresh = now.getTime() - 2 * 3_600_000
    const evOf = (k: string): Record<string, unknown> => ({
      sourceEvidence: buildSourceEvidence({
        postedAt: iso(fresh), capturedAt: iso(fresh + 30 * 60_000), sourceSite: site, sourceArticleId: k, dedupKey: `${site}|${k}`,
        response: { comments: 3, views: 100, observedAt: iso(fresh + 30 * 60_000) },
        sourceStats: { basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: site, bucket: '<3h', n: 5,
          commentsPct: 0.5, viewsPct: 0.5, windowFrom: iso(fresh - 72 * 3_600_000), windowTo: iso(fresh + 30 * 60_000) },
        participationDriver: '공감',
      }),
    })
    const intentOf = (k: string, runId: string): Record<string, unknown> => ({
      contract: SUPPLY_JIT_CONTRACT, runId, sourceHash: articleIdHashOf(site, k), intendedSlotAt: '2026-10-01T00:00:00.000Z', ageAtSlotH: 5,
    })
    const runAt = (runId: string): Date => new Date(Date.UTC(+runId.slice(0, 4), +runId.slice(4, 6) - 1, +runId.slice(6, 8), +runId.slice(9, 11), +runId.slice(11, 13)))
    const wipeP = async (): Promise<void> => {
      await prisma.originalPostApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: 'p0r-' } } })
      await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: site } })
    }
    await wipeP()
    const dir = mkdtempSync(join(tmpdir(), 'p0-2215-'))
    const home = mkdtempSync(join(tmpdir(), 'p0-2215-home-'))
    const prevHome = process.env.HOME
    // 결말 배분 — 도장된 16: 공개 8 · 만료 2 · 대기(APPROVED) 6 / 22:15 회차 4: 도장 전 기계 적재
    const fates = ['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED',
      'EXPIRED', 'EXPIRED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'] as const
    const ledgerLines = new Map<string, LedgerEntry[]>()
    const ledger = (runId: string, k: string, status: LedgerEntry['status'], settledUsd: number | null, reservedUsd: number | null): void => {
      const at = runAt(runId)
      const day = new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
      const e: LedgerEntry = {
        runId: `${runId}-d`, stage: 'draftGen', attemptId: `p0r-${runId}-${k}-${status}`, requestNo: 0, provider: 'google',
        apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash', status, blockCode: null, countedInputTokens: 100, maxOutputTokens: 1200,
        reservedUsd, inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
        settledUsd, pricingVersion: 'p0', startedAt: at.toISOString(), endedAt: at.toISOString(), errorCode: null,
        sourceKey: articleIdHashOf(site, k), supplyContract: SUPPLY_JIT_CONTRACT,
      }
      ledgerLines.set(day, [...(ledgerLines.get(day) ?? []), e])
    }
    try {
      let n = 0
      let stampedIdx = 0
      const mk = async (k: string, runId: string, status: string, by: string, decidedAt: Date): Promise<void> => {
        const raw = await prisma.microSeedRawContent.create({
          data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/${k}`, sourceArticleId: k,
            sourceCapturedAt: new Date(fresh), rawTitle: `원문 ${k}`, rawBody: `원문 본문 ${k}` }, select: { id: true },
        })
        await prisma.originalPostApprovalQueue.create({
          data: { sourceRawContentId: raw.id, status: status as never, draftTitle: `초안 ${k}`, draftBody: `본문 ${k}`, gateVerdict: 'PASS',
            promptVersion: 'p0r', model: 'p0r', gateResults: { ...evOf(k), [SUPPLY_INTENT_KEY]: intentOf(k, runId) } as Prisma.InputJsonValue,
            decidedBy: by, decidedAt, dedupKey: `p0r-${k}` },
        })
      }
      for (const [runId, sources, ready] of RUNS) {
        const ids = Array.from({ length: ready }, (_, i) => `${runId}-r${i}`)
        writeFileSync(join(dir, worksetFileName(runId)), wsV3(runId, site, sources, ids))
        for (const k of ids) {
          if (runId === LATE) await mk(k, runId, 'APPROVED', 'machine:content-core-v2', new Date(runAt(runId).getTime() + 60_000))
          else { await mk(k, runId, fates[stampedIdx]!, AUTO_DECIDER, new Date(runAt(runId).getTime() + 5 * 60_000)); stampedIdx += 1 }
          ledger(runId, k, 'settled', 0.01, 0.02)
          n += 1
        }
      }
      // 🔴 사용량 미상 2건 — 08:15 회차(READY 0 · 원천 하나) · 22:15 회차(READY 하나)
      ledger('20261007-231502', '20261007-231502-x0', 'usageUnknown', null, 0.008652)
      ledger(LATE, `${LATE}-r0`, 'usageUnknown', null, 0.0085926)
      // 🔴 창 밖 회차 행 — 앞(창 전 회차 · decidedAt 은 창 안) · 뒤(10-09 08:15 회차) — 둘 다 제외여야 한다
      for (const runId of [OUT_BEFORE, OUT_AFTER]) {
        writeFileSync(join(dir, worksetFileName(runId)), wsV3(runId, site, 8, [`${runId}-r0`]))
        await mk(`${runId}-r0`, runId, 'APPROVED', AUTO_DECIDER, runId === OUT_BEFORE ? new Date('2026-10-05T23:00:00Z') : new Date('2026-10-08T23:00:00Z'))
      }
      const ldir = ledgerDirForHome(home)
      mkdirSync(ldir, { recursive: true })
      for (const [day, es] of ledgerLines) writeFileSync(join(ldir, `${day}.jsonl`), `${es.map((e) => JSON.stringify(e)).join('\n')}\n`)
      check('fixture 전제 — 창 안 회차 11 · 원천 101 · READY 20(도장 16 + 22:15 도장 전 4) · 창 밖 회차 행 2',
        RUNS.length === 11 && RUNS.reduce((a, r) => a + r[1], 0) === 101 && n === 20 && stampedIdx === 16)
      // 🔴 앞판 분자 — 같은 DB 에서 decidedAt 창 + 자동 도장만 세면 16 (22:15 4건 · 창 밖 회차 행은 시각상 빠지거나 끼어든다)
      const oldNumerator = (await prisma.originalPostApprovalQueue.findMany({
        where: { dedupKey: { startsWith: 'p0r-' }, decidedBy: AUTO_DECIDER, decidedAt: { gte: windowFrom, lt: windowTo } },
        select: { gateResults: true },
      })).filter((r) => RUNS.some(([id]) => ((r.gateResults as Record<string, Record<string, unknown>>)[SUPPLY_INTENT_KEY]?.runId) === id)).length
      check('🔴 앞판 분자(decidedAt 창 · 창 안 회차) = 16 → floor(16 × 60 ÷ 101) = 9 (07:00 기록과 같다)',
        oldNumerator === 16 && Math.floor((16 * 60) / 101) === 9, String(oldNumerator))
      // 🔴 07:00 운영 기록 그대로의 cohort 로 앞판 판정을 재현한다 — 공급 능력 9 · 필요 12
      const old0700 = judgeNextPreflight('d10', {
        slotValidOpportunities: 10, readyCohort: { sources: 101, published: 8, lost: 2, scheduled: 6, unknown: 0, usdPerSlotValidResult: null },
        latencyP50H: 46.99, latencyP90H: 68.81, contractValidPersonas: 30, commentUsdPerRequest: 0.003, commentDailyUsdCap: 0.2,
        auditUsdPerCall: 0.001, auditDailyUsdCap: 0.3, supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
      }, RUNNER_GRID)
      check('🔴 앞판 07:00 재현 — readyCapacity 9 · readyNeeded 12 · THROUGHPUT_SHORT · SUPPLY_COST_UNKNOWN',
        old0700.counts.readyCapacity === 9 && old0700.counts.readyNeeded === 12
        && old0700.codes.includes('THROUGHPUT_SHORT') && old0700.codes.includes('SUPPLY_COST_UNKNOWN'), JSON.stringify(old0700.counts))
      process.env.HOME = home
      const env = { SORAN_LLM_DAILY_BUDGET_USD: '0.5', SORAN_LLM_RUN_REQUEST_CAP: '40', SORAN_LLM_RESERVE_HEADROOM: '1.2' }
      const factsNow = async (): Promise<Awaited<ReturnType<typeof readPreflightFacts>>> => readPreflightFacts(prisma, {
        loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
        autoOpen: { open: false, reasons: [] }, proofSlots: slotTimesOn('2026-10-09', profileOf('d10')),
        caps: releaseCapsOf(profileOf('d10')), evidenceDate: '2026-10-08', env, dataDir: dir, now,
        runnerHealth: 'ok', contractValidPersonas: async () => 30,
      })
      const r = await factsNow()
      const c = r.facts.readyCohort
      check('🔴 🔴 **회차 시계 — 창 안 회차 행 20 전부 · 창 밖 회차 행 2 제외 · 원천 101 · 불일치 0**',
        c !== null && c.sources === 101 && r.detail.readyCount === 20 && (r.detail.intentMismatches as unknown[]).length === 0,
        JSON.stringify({ c, n: r.detail.readyCount, m: r.detail.intentMismatches }))
      check('🔴 🔴 **22:15 도장 전 4건은 성공으로 확정하지 않는다 — 결말 모름 · 공개 8 · 손실 2 · 모름 10(대기 6 + 도장 전 4)**',
        c !== null && c.published === 8 && c.lost === 2 && c.scheduled === 0 && c.unknown === 10, JSON.stringify(c))
      const v = judgeNextPreflight('d10', r.facts, RUNNER_GRID)
      check('🔴 🔴 **보정 후 공급 능력 11 (앞판 9) · 필요 하한 12 → 여전히 THROUGHPUT_SHORT (11 < 12) · D10 FAIL**',
        v.counts.readyCapacity === 11 && v.counts.readyNeededMin === 12 && v.codes.includes('THROUGHPUT_SHORT') && v.verdict === 'FAIL',
        JSON.stringify({ counts: v.counts, codes: v.codes }))
      // 🔴 도장 전 행이 예정 슬롯에 짝지어져도 성공(예정)으로 세지 않는다 — 짝지은 열쇠를 직접 준다
      const lateIds = (await prisma.originalPostApprovalQueue.findMany({ where: { dedupKey: { startsWith: `p0r-${LATE}-` } }, select: { id: true } })).map((x) => x.id)
      const stampedPending = (await prisma.originalPostApprovalQueue.findMany({ where: { dedupKey: { startsWith: 'p0r-' }, status: 'APPROVED', decidedBy: AUTO_DECIDER }, select: { id: true } })).map((x) => x.id)
      const direct = await readReadyCohort(prisma, {
        windowFrom, windowTo, dataDir: dir, matched: new Set([...lateIds, ...stampedPending]), horizon: slotTimesOn('2026-10-09', profileOf('d10')), now,
      })
      check('🔴 🔴 **도장 전 4건은 슬롯에 짝지어져도 모름 — 도장된 대기 6만 예정 · 모름 4 (창 밖 회차 행은 제외)**',
        lateIds.length === 4 && direct.fates !== null && direct.fates.unknown === 4 && direct.fates.scheduled === 6, JSON.stringify(direct.fates))
      // 🔴 비용 — 정산 $0.20 + 예약 상한 $0.0172446 → ÷ 확인 결과 8
      const perResult = (20 * 0.01 + 0.008652 + 0.0085926) / 8
      check('🔴 🔴 **사용량 미상 2건 → 예약 상한으로 분자에 · 결과당 = (정산 $0.20 + 상한 $0.0172446) ÷ 8 · SUPPLY_COST_UNKNOWN 없음**',
        c !== null && c.usdPerSlotValidResult !== null && Math.abs(c.usdPerSlotValidResult - perResult) < 1e-9
        && !v.codes.includes('SUPPLY_COST_UNKNOWN') && !v.codes.includes('SUPPLY_COST_SHORT'),
        JSON.stringify({ usd: c?.usdPerSlotValidResult, perResult, codes: v.codes }))
      check('preflight 메모가 "상한" 임을 말한다 — 미정산 2건 · 상한 $0.0172',
        (r.notes as string[]).some((x) => /공급 비용은 상한이다 — 미정산 2건을 예약 상한 \$0\.0172/.test(x)), JSON.stringify(r.notes))
      // 🔴 예약이 없는 미상 하나 → 상한도 모른다 → SUPPLY_COST_UNKNOWN 그대로
      const d22 = ledgerLines.get('2026-10-08')!
      const noRes = d22.map((e) => (e.status === 'usageUnknown' ? { ...e, reservedUsd: null } : e))
      writeFileSync(join(ldir, '2026-10-08.jsonl'), `${noRes.map((e) => JSON.stringify(e)).join('\n')}\n`)
      const rNo = await factsNow()
      const vNo = judgeNextPreflight('d10', rNo.facts, RUNNER_GRID)
      check('🔴 🔴 **예약 없는 사용량 미상 → 결과당 비용 null · SUPPLY_COST_UNKNOWN 유지**',
        rNo.facts.readyCohort?.usdPerSlotValidResult === null && vNo.codes.includes('SUPPLY_COST_UNKNOWN'), JSON.stringify(vNo.codes))
      writeFileSync(join(ldir, '2026-10-08.jsonl'), `${d22.map((e) => JSON.stringify(e)).join('\n')}\n`)
      // 🔴 runId 불일치 — 창 안 행의 의도를 다른 창 안 회차로 옮긴다(그 회차 묶음엔 이 원천이 없다) → 불일치 · cohort 모름
      const one = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { dedupKey: 'p0r-20261008-051506-r0' }, select: { id: true, gateResults: true } })
      const g = one.gateResults as Record<string, Record<string, unknown>>
      await prisma.originalPostApprovalQueue.update({ where: { id: one.id }, data: { gateResults: { ...g, [SUPPLY_INTENT_KEY]: { ...g[SUPPLY_INTENT_KEY], runId: '20261008-081504' } } as Prisma.InputJsonValue } })
      const rRun = await factsNow()
      check('🔴 🔴 **runId 불일치(창 안 다른 회차 · 그 묶음에 원천 없음) → WORKSET_NOT_FOUND · cohort 없음(모름)**',
        rRun.facts.readyCohort === null && JSON.stringify(rRun.detail.intentMismatches) === JSON.stringify(['WORKSET_NOT_FOUND']), JSON.stringify(rRun.detail.intentMismatches))
      // 🔴 sourceHash 불일치 — 의도 해시를 바꾼다(증거 해시와 다르다)
      await prisma.originalPostApprovalQueue.update({ where: { id: one.id }, data: { gateResults: { ...g, [SUPPLY_INTENT_KEY]: { ...g[SUPPLY_INTENT_KEY], sourceHash: articleIdHashOf(site, 'other') } } as Prisma.InputJsonValue } })
      const rHash = await factsNow()
      check('🔴 🔴 **sourceHash 불일치 → EVIDENCE_HASH_MISMATCH · cohort 없음(모름)**',
        rHash.facts.readyCohort === null && JSON.stringify(rHash.detail.intentMismatches) === JSON.stringify(['EVIDENCE_HASH_MISMATCH']))
      await prisma.originalPostApprovalQueue.update({ where: { id: one.id }, data: { gateResults: g as Prisma.InputJsonValue } })
      // 🔴 사람이 결정한 기계 행(도장 전에 사람 경로로 간 행)은 자동 READY 가 아니다
      await prisma.originalPostApprovalQueue.updateMany({ where: { dedupKey: `p0r-${LATE}-r1` }, data: { decidedBy: 'founder' } })
      const rHuman = await factsNow()
      check('사람 결정 행은 cohort 밖 — READY 19', rHuman.detail.readyCount === 19, String(rHuman.detail.readyCount))
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      rmSync(dir, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
      await wipeP()
    }
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()
