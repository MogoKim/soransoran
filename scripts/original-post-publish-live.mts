#!/usr/bin/env tsx
/**
 * Original Post 발행 — 🔴 기본은 dry-run. 되돌릴 수 없는 경로다
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §4
 *
 *   … → ⑥ Matching → 배정 저장 → **⑦ 발행(여기)**
 *
 * 🔴 **여기서 나간 글은 검색에 노출된다.**
 *    세 축이 전부 false 인 유일한 레인이고 sitemap 에 실린다.
 *    지금까지의 단계는 전부 되돌릴 수 있었지만 이건 아니다 —
 *    글이 나간 뒤에는 내리는 것(status=HIDDEN)이지 없던 일로 만들 수 없다.
 *
 * 🔴 **write 로직을 여기서 다시 짜지 않는다.**
 *    src/lib/original-post-publish-tx.ts 의 publishOriginalPostTx 를 부른다.
 *    둘로 나뉘면 게이트도 둘이 된다 (persona-publish-live 와 같은 원칙).
 *
 * 🔴 **dry-run 결과를 신뢰하지 않는다.**
 *    dry-run 은 판정 시점의 사진이다. 실제 발행은 트랜잭션 안에서 다시 판정한다 —
 *    배정과 발행 사이에 페르소나가 paused 됐을 수 있다.
 *
 * 🔴 **첫 발행은 gate=PASS 만.** HOLD 는 사람이 한 번 더 본 뒤다.
 * 🔴 **하루 1건.** 색인되는 첫 글들이라 문제가 생겨도 원인을 가릴 수 있어야 한다.
 *
 * 사용법
 *   npx tsx scripts/original-post-publish-live.mts               dry-run
 *   npx tsx scripts/original-post-publish-live.mts --apply --limit=1   🔴 실제 발행
 *   npx tsx scripts/original-post-publish-live.mts --check        발행 결과 대조
 *
 * 종료 코드: --apply 가 발행하지 못하거나 --check 실패면 1
 */
import { PrismaClient } from '@prisma/client'
import {
  judgePublish, kstDayStart, DAILY_PUBLISH_CAP, FIRST_PUBLISH_VERDICT,
  PUBLISH_BLOCK_LABEL, type PublishBlockCode,
} from '../src/lib/original-post-publish'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { MANUAL_PUBLISH_CAP, judgeManualLimit } from '../src/lib/original-post-publish'
import { resolveScale, SAFEST_SCALE, describeScale } from '../src/lib/scale-runtime'
import { verifyPublishedRow } from '../src/lib/original-post-publish-verify'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  parseIdArgs, filterByIds, missingIds, checkLimitAgainstIds, describeIdTargeting,
} from '../src/lib/original-post-id-target'
// 🔴 3축 판정은 정본 게이트 함수가 한다 (노출 게이트 C-2 · C-4)
import { isSearchIndexable, isDiscoveryEligible } from '../src/lib/post-visibility'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const CHECK = argv.includes('--check')
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
// 🔴 --id 를 주면 그 건만 발행한다. 없으면 지금까지와 똑같이 배치 전체를 본다 (§4-AK)
const IDS = parseIdArgs(argv)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date): string =>
  `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`
/** 🔴 전문을 남기지 않는다 — 첫 글자 + 길이 */
const brief = (v: string): string => {
  const c = [...v.trim()]
  return c.length === 0 ? '(비어 있음)' : `"${c[0]}…" (${c.length}자)`
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ ${CHECK ? '검증 (--check)' : APPLY ? '🔴 실제 발행 (--apply)' : 'dry-run (DB write 0)'} ══\n`)

// ── kill switch — 🔴 읽기만 한다 ──
const sw = await prisma.personaGlobalSwitch.findUnique({
  where: { id: 'global' }, select: { enabled: true, reason: true },
})
const killed = sw?.enabled === true
console.log(`  전체 중지(kill switch)  ${killed ? `🔴 켜짐 — ${sw?.reason ?? '사유 없음'}` : `꺼짐${sw === null ? ' (행 없음 = 기본 상태)' : ''}`}`)

// ── 오늘(KST) 발행 수 — 🔴 cap 의 근거 ──
const now = new Date()
const dayStart = kstDayStart(now)
const publishedToday = await prisma.personaActivityLog.count({
  where: { kind: 'post', createdAt: { gte: dayStart } },
})
/**
 * 🔴 **이 도구는 규모 확장 경로가 아니다** (2026-09-08, Codex P0).
 *
 *    예전 판은 `installFromEnv(process.env)` 를 **준비도 없이** 불렀다.
 *    그러면 `SORAN_RELEASE_STAGE=d10` 환경에서 사람이 `--apply --limit=10` 을 치면
 *    준비도 판정을 한 번도 거치지 않고 **10건이 그대로 나간다** — 자동 레인이 지키는
 *    감속을 손으로 우회하는 문이 열린 것이다.
 *
 *    그래서 이 도구의 적용 상한은 **환경과 무관하게 항상 가장 안전한 d1(하루 1건)** 이다.
 *    d3 · d5 · d10 확장은 준비도를 계산하는 `original-post-auto-publish` 경로만 허용한다.
 *
 *    🔴 **수동 도구는 긴급 단건 발행 전용이다.**
 *
 *    설정은 **보여 주기만** 한다 — 사람이 "환경은 d10 인데 왜 1건이지" 를 묻지 않도록.
 */
const envScale = resolveScale(process.env)
const scale = SAFEST_SCALE
// 🔴 정본은 `MANUAL_PUBLISH_CAP` 하나다 — 여기서 다시 계산하지 않는다
const RELEASE_DAILY_CAP = MANUAL_PUBLISH_CAP
console.log('  🔴 수동 도구는 **긴급 단건 발행 전용**이다 — 규모 확장 경로가 아니다')
console.log(`  적용 상한  하루 ${RELEASE_DAILY_CAP}건 (항상 가장 안전한 단계 · 환경 설정과 무관)`)
if (envScale.capacityStage !== 'd1' || envScale.requestedRelease !== 'd1') {
  console.log(`  🟡 환경 설정은 ${describeScale(envScale)} 이지만 **이 도구에는 적용하지 않는다**`)
  console.log('     d3·d5·d10 확장은 준비도를 계산하는 original-post-auto-publish 경로만 허용한다')
}
console.log(`  오늘(KST ${kst(now).slice(0, 10)}) 발행  ${publishedToday} / ${RELEASE_DAILY_CAP}건`)
console.log(`  첫 발행 판정  gate=${FIRST_PUBLISH_VERDICT} 만 · HOLD 제외\n`)

// ══ --check — 발행 결과 대조 ══
if (CHECK) {
  // 🔴 **PUBLISHED 만 보면 반쪽이다.** 발행은 됐는데 큐가 그렇게 말하지 않는 행
  //    (createdPostId 는 있는데 status≠PUBLISHED)이 검사 밖으로 새어 나간다 —
  //    그 행은 다음 회차가 **같은 글을 또 낼 수 있는** 상태다.
  const published = await prisma.originalPostApprovalQueue.findMany({
    where: { OR: [{ status: 'PUBLISHED' }, { NOT: { createdPostId: null } }] },
    select: {
      id: true, status: true, createdPostId: true,
      matchedPersona: { select: { id: true, code: true } },
    },
  })
  console.log(`검사 대상 ${published.length}건 (PUBLISHED · createdPostId 가 있는 행)`)
  let bad = 0
  for (const row of published) {
    if (row.createdPostId === null) {
      // 🔴 판정은 공용 정본이 한다 — 여기서 문구를 따로 만들지 않는다
      const p0 = verifyPublishedRow({
        queueId: row.id, queueStatus: row.status, createdPostId: null,
        queuePersonaId: row.matchedPersona?.id ?? null, post: null, activityLogCount: 0,
      })
      if (p0.length > 0) { console.log(`  🔴 ${row.id} — ${p0.join(' · ')}`); bad += 1 }
      continue
    }
    const post = await prisma.post.findUnique({
      where: { id: row.createdPostId },
      select: {
        id: true, status: true, boardType: true, source: true, personaId: true, authorId: true,
        isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true,
        sourceUrl: true, sourceArticleId: true, sheetCandidateId: true,
      },
    })
    const log = await prisma.personaActivityLog.count({
      where: { personaId: row.matchedPersona?.id ?? '', kind: 'post', targetId: row.createdPostId },
    })
    // 🔴 판단은 공용 정본이 한다 — 관제(supply:health)와 **같은 함수**를 쓴다.
    //    두 곳이 각자 판단하면 언젠가 한쪽만 고쳐지고, 그날 어느 쪽을 믿을지 알 수 없다.
    const problems = verifyPublishedRow({
      // 🔴 하드코딩하지 않는다 — 실제 status 를 넘겨야 불일치가 드러난다
      queueId: row.id, queueStatus: row.status, createdPostId: row.createdPostId,
      queuePersonaId: row.matchedPersona?.id ?? null,
      post: post === null ? null : {
        status: post.status, source: post.source, boardType: post.boardType,
        personaId: post.personaId,
        // 🔴 3축 판정은 post-visibility 정본 함수가 한다
        searchIndexable: isSearchIndexable(post), discoveryEligible: isDiscoveryEligible(post),
        sourceUrl: post.sourceUrl, sourceArticleId: post.sourceArticleId,
        sheetCandidateId: post.sheetCandidateId,
      },
      activityLogCount: log,
    })

    if (problems.length > 0) { bad += 1; console.log(`  🔴 ${row.id} — ${problems.join(' · ')}`) }
    else console.log(`  ✅ ${row.id} → Post ${row.createdPostId} · ${row.matchedPersona?.code} · /community/free/${row.createdPostId}`)
  }
  await prisma.$disconnect()
  console.log(bad === 0 ? `\n✅ ${published.length}건 전부 정합\n` : `\n🔴 ${bad}건 이상\n`)
  process.exit(bad === 0 ? 0 : 1)
}

// ── 후보 조달 — 🔴 읽기만 한다 ──
const allRows = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true, matchedAt: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    matchedPersona: {
      // 🔴 실회원 판별 정본은 Account 다 — providerId 는 adapter 가 채우지 않는다
      select: {
        code: true, status: true,
        user: { select: { providerId: true, _count: { select: { accounts: true } } } },
      },
    },
  },
  // 🔴 gate=PASS 를 먼저, 그다음 배정이 이른 순 — 정렬이 흔들리면 dry-run 이 재현되지 않는다
  orderBy: [{ gateVerdict: 'asc' }, { matchedAt: 'asc' }, { id: 'asc' }],
})
// 🔴 지정한 id 만 남긴다 — 순서는 바꾸지 않는다(dry-run 재현성)
const rows = filterByIds(allRows, IDS)
const missing = missingIds(allRows, IDS)
console.log(describeIdTargeting(IDS))
if (missing.length > 0) {
  console.log(`  🟡 지정했지만 후보에 없는 id ${missing.length}건 — 이미 발행됐거나 APPROVED·EDITED 가 아닙니다`)
  for (const m of missing) console.log(`     ${m}`)
}
console.log(`── 후보 ${rows.length}건 (APPROVED · EDITED · 발행 전)\n`)

const eligible: string[] = []
for (const r of rows) {
  const v = judgePublish(
    {
      status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
      matchedPersonaCode: r.matchedPersona?.code ?? null,
      personaStatus: r.matchedPersona?.status ?? null,
      personaProviderId: r.matchedPersona?.user?.providerId ?? null,
      // 🔴 persona 가 없으면 null 이고 judgePublish 가 fail-closed 로 막는다
      personaAccountCount: r.matchedPersona?.user?._count.accounts ?? null,
    },
    // 🔴 여기서는 cap 을 이미 채운 것으로 보지 않는다. 몇 건이 자격이 있는지부터 센다
    // 🔴 여기서는 cap 을 이미 채운 것으로 보지 않는다. 상한은 설치된 값을 그대로 쓴다
    { killSwitchEnabled: killed, publishedToday: 0, dailyCap: RELEASE_DAILY_CAP },
  )
  const title = r.editedTitle ?? r.draftTitle
  const head = `  ${r.id}  ${r.status} · gate=${r.gateVerdict} · ${r.matchedPersona?.code ?? '미배정'}`
  if (v.ok) {
    eligible.push(r.id)
    console.log(`  ✅ ${head}\n       제목 ${brief(title)}`)
  } else {
    console.log(`  ⏭️  ${head}\n       ${v.detail}`)
  }
}

// 🔴 cap 을 반영해 이번에 나갈 것만 남긴다
const capRoom = Math.max(0, RELEASE_DAILY_CAP - publishedToday)
const take = eligible.slice(0, capRoom)
console.log(`\n  자격 ${eligible.length}건 · 오늘 남은 cap ${capRoom}건 · 이번 발행 ${take.length}건`)
if (take.length > 0) console.log(`  🟢 첫 발행 후보  ${take[0]}`)

if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · Post 0 · 발행하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
  process.exit(0)
}

// ── 🔴 --apply --limit 둘 다 있어야 발행한다 ──
if (killed) { await prisma.$disconnect(); fail('전체 중지가 켜져 있습니다.') }
const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
// 🔴 **write 전에 막는다.** 판정은 `judgeManualLimit` 정본 하나다 —
//    환경이 d10 이어도 이 도구로는 2건 이상 나가지 않는다
const manual = judgeManualLimit(LIMIT)
if (!manual.ok) {
  await prisma.$disconnect()
  fail(`${manual.reason}\n     🔴 수동 도구는 긴급 단건 발행 전용입니다.`)
}
// 🔴 --id 를 줬으면 개수가 정확히 맞아야 한다 — 하나라도 발행 불가면 멈춘다 (§4-AK)
const idCheck = checkLimitAgainstIds(LIMIT, IDS, take.length)
if (!idCheck.ok) { await prisma.$disconnect(); fail(idCheck.message) }
if (LIMIT !== take.length) {
  await prisma.$disconnect(); fail(`--limit ${LIMIT} 이 이번 발행 대상 ${take.length} 과 다릅니다. 잘라내지 않고 멈춥니다.`)
}

console.log(`\n══ 발행 ${take.length}건 (--limit ${LIMIT}) ══`)
let done = 0
let failedCount = 0
for (const id of take) {
  // 🔴 매 건 직전에 다시 센다. 같은 실행 안에서도 cap 이 소비된다
  const today = await prisma.personaActivityLog.count({
    where: { kind: 'post', createdAt: { gte: dayStart } },
  })
  // 🔴 사람이 부르는 긴급 단건 경로 — 기존 동작 그대로(주입 상한 · 슬롯 게이트 없음)
  const res = await publishOriginalPostTx(prisma, { queueId: id, publishedToday: today, mode: { kind: 'manual-live', dailyCap: RELEASE_DAILY_CAP } })
  if (res.kind === 'published') {
    done += 1
    console.log(`  ✅ ${id}\n     Post ${res.postId} · ${res.personaCode} · ${res.boardType}`)
    console.log(`     https://soransoran.com/community/free/${res.postId}`)
    console.log('     🔴 이 글은 검색에 노출됩니다 — sitemap 에 실립니다')
  } else if (res.kind === 'blocked') {
    failedCount += 1
    console.log(`  ⛔ ${id} — ${PUBLISH_BLOCK_LABEL[res.code as PublishBlockCode] ?? res.code}: ${res.detail}`)
  } else {
    failedCount += 1
    console.log(`  🔴 ${id} — ${res.message}`)
  }
}

const pub = await prisma.originalPostApprovalQueue.count({ where: { status: 'PUBLISHED' } })
const posts = await prisma.post.count()
await prisma.$disconnect()
console.log(`\n  발행 ${done}건 · 실패 ${failedCount}건`)
console.log(`  대기열 PUBLISHED ${pub}건 · Post ${posts}건`)
console.log('  🔴 --check 로 검증하세요. 되돌리려면 내리는 것(status=HIDDEN)이지 없던 일이 되지 않습니다.\n')
process.exit(failedCount === 0 ? 0 : 1)
