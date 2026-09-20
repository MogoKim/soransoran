#!/usr/bin/env tsx
/**
 * 기계 후보 **사람 검토** — 🔴 기본 read-only. DB write 0
 *
 * 🔴 **왜 필요한가** (2026-09-14).
 *
 *    나이·세대 모순을 3/3 잡는 검수 모델이 **없다**(실측 — haiku 1/3 · gpt-5-mini 0/3 ·
 *    gemini-3.7-flash 2/3). 그래서 기계가 만든 글은 **사람이 한 번 보고 나서야**
 *    자동 발행 대상이 된다(`selectAutoTargets` 가 `HUMAN_REVIEW_REQUIRED` 로 막는다).
 *
 *    이 명령은 그 "한 번 보는" 자리다. 사람이 읽고, 괜찮으면 `decidedBy` 를 `founder` 로 바꾼다.
 *
 * 🔴 **새 컬럼도 migration 도 만들지 않는다.** 큐에 이미 있는 `decidedBy` 하나를 쓴다.
 *
 * 🔴 **바꾸는 것은 `decidedBy`·`decidedAt` 두 칸뿐이다.**
 *    본문 · 제목 · `status` · `gateResults` · Post · Comment · Persona 는 건드리지 않는다.
 *    provider 를 부르지 않는다. 기계 생성 provenance 는 그대로 남는다.
 *
 *    🔴 `decidedAt` 이 함께 바뀌는 이유 — "누가" 만 적고 "언제" 를 기계 적재 시각으로 두면
 *    그 기록이 거짓이 된다. 그리고 `queueOrderKey` 가 `decidedAt` 으로 줄을 세우므로,
 *    함께 바꿔야 자동 발행 순서가 **실제 사람 검토 순서**가 된다.
 *
 * 🔴 **Persona·나이대 근거가 없으면 검토 완료를 거부한다.**
 *    글쓴이가 몇 살인지 모르는 채로 "사람이 봤다" 고 적으면, 그 표시는 거짓이 된다 —
 *    나이 관점을 볼 수 없었는데 봤다고 기록하는 셈이다.
 *
 * 사용법
 *   npm run publish:machine-review                     대기 목록 (read-only)
 *   npm run publish:machine-review -- --id <queueId>   한 건 전문 (read-only)
 *   npm run publish:machine-review -- --id <id> --apply --limit=1   🔴 검토 완료 표시
 *
 * 종료 코드: 검토 완료에 실패하면 1 · 그 외 0
 */
import { PrismaClient } from '@prisma/client'

import {
  MACHINE_REVIEWED_BY, machineReviewedByHuman, profileOf, voiceInputOf,
  judgeReviewSnapshot, type AutoRow, type ReviewSnapshot,
} from '../src/lib/original-post-auto-publish'
import { MACHINE_AGE_HUMAN_REVIEW_NOTE } from '../src/lib/micro-seed-auto-draft'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { PERSONA_POOL_DOC } from './micro-seed-auto-draft.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
/**
 * 🔴 **사람이 볼 근거는 로컬 artifact 정본이다** (2026-09-20).
 *    원문 근거를 DB 로 복사하지 않는다 — 큐에는 `sourceArticleId` 열쇠만 있다.
 */
import {
  findReviewArtifact, readReviewArtifact, reviewEvidenceLines, artifactCostUsd,
  currentText, editDiffLines, completeReview,
  type ReviewArtifact, type ReviewTarget,
} from '../src/lib/original-post-machine-review'
import { DATA_DIR } from './micro-seed-auto-draft.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ONLY_ID = (argv.find((a) => a.startsWith('--id='))?.slice(5)
  ?? (argv.includes('--id') ? argv[argv.indexOf('--id') + 1] : undefined) ?? '').trim()
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)

// 🔴 변수에 타입을 적어야 TS 가 `never` 로 좁혀 준다 (화살표 반환형만으로는 부족하다)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date | null): string =>
  d === null ? '—' : `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`

await loadEnvLocal()
const prisma = new PrismaClient()

const ageOf = new Map(
  parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards.map((c) => [c.code, c.ageBand]),
)

console.log(APPLY ? '\n══ 🔴 검토 완료 표시 (--apply) ══\n' : '\n══ 기계 후보 사람 검토 (read-only · DB write 0) ══\n')
console.log(`  ${MACHINE_AGE_HUMAN_REVIEW_NOTE}`)
console.log(`  🔴 바꾸는 것은 decidedBy·decidedAt 두 칸뿐이다 — 본문 · status · gateResults · Post 는 건드리지 않는다\n`)

const raw = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    promptVersion: true, model: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    // 🔴 낙관적 잠금의 근거 — 사람이 읽은 뒤 행이 한 번이라도 쓰였으면 값이 바뀐다
    updatedAt: true,
    gateResults: true, decidedBy: true, decidedAt: true, createdAt: true,
    rawContent: { select: { sourceSite: true } },
  },
  orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }],
})
const rows: AutoRow[] = raw.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: String(r.gateVerdict),
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite, gateResults: r.gateResults,
  decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
}))

/**
 * 🔴 **사람이 읽은 그 순간의 모습**을 남긴다 — UPDATE 직전에 다시 읽어 대조한다.
 *    발행 문안(`edited ?? draft`)으로 담는다. draft 만 담으면 수정본이 바뀐 것을 놓친다.
 */
// 🔴 Prisma enum 타입을 그대로 쓰려면 원본 행을 들고 있어야 한다 (문자열로 넘기면 where 가 거부한다)
const rawById = new Map(raw.map((r) => [r.id, r]))
const snapOf = new Map<string, ReviewSnapshot>(raw.map((r) => [r.id, {
  status: r.status, createdPostId: r.createdPostId, decidedBy: r.decidedBy,
  updatedAt: r.updatedAt,
  title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
  promptVersion: r.promptVersion, model: r.model, gateResults: r.gateResults,
}]))

/**
 * 🔴 **로컬 artifact 정본을 읽는다.** DB 가 아니다 — 원문 근거는 여기에만 있다.
 *    회차 파일이 여럿이면 전부 읽는다 (한 원천이 여러 회차에 있을 수 있다).
 */
function loadArtifacts(): ReviewArtifact[] {
  if (!existsSync(DATA_DIR)) return []
  const out: ReviewArtifact[] = []
  for (const f of readdirSync(DATA_DIR).filter((x) => x.endsWith('.artifacts.json'))) {
    try {
      const j = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as unknown[]
      for (const a of Array.isArray(j) ? j : []) {
        const r = readReviewArtifact(a)
        if (r !== null) out.push(r)
      }
    } catch { /* 🔴 못 읽은 파일은 없는 것으로 둔다 — 근거 없으면 검토가 막힌다 */ }
  }
  return out
}
const ARTIFACTS = loadArtifacts()

/** 🔴 큐 행이 가리키는 열쇠 둘 — 없으면 artifact 를 찾을 수 없다 */
function keysOf(r: AutoRow): { artifactId: string | null; sourceArticleId: string | null } {
  const g = r.gateResults as Record<string, unknown> | null
  const ad = (g?.autoDraft ?? null) as Record<string, unknown> | null
  const pick = (k: string): string | null => {
    const v = ad?.[k]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }
  return { artifactId: pick('artifactId'), sourceArticleId: pick('sourceArticleId') }
}

/**
 * 🔴 **artifact 는 최초 초안과 견준다.** 사람이 고친 글과 견주면 정상적인
 *    EDIT_REQUIRED 수정이 전부 `draftMismatch` 로 막힌다.
 */
function targetOf(r: AutoRow): ReviewTarget {
  const raw = rawById.get(r.id)
  return {
    ...keysOf(r),
    draftTitle: raw?.draftTitle ?? r.title,
    draftBody: raw?.draftBody ?? r.body,
    editedTitle: raw?.editedTitle ?? null,
    editedBody: raw?.editedBody ?? null,
  }
}

/** 🔴 이 후보의 글쓴이가 누구이고 몇 살인가 — 모르면 검토 완료를 거부한다 */
type Ground = { personaCode: string | null; ageBand: string | null; ok: boolean; reason: string }
function groundOf(r: AutoRow): Ground {
  const code = voiceInputOf(r).voice?.personaCode ?? null
  if (code === null) {
    return { personaCode: null, ageBand: null, ok: false, reason: '생성 Persona 기록이 없다 — 누가 쓴 글인지 모른다' }
  }
  const band = ageOf.get(code) ?? null
  if (band === null || band.trim() === '') {
    return { personaCode: code, ageBand: null, ok: false, reason: `${code} 의 정본 나이대(ageBand)를 읽지 못했다` }
  }
  /**
   * 🔴 **사람이 볼 근거가 없으면 검토 완료를 거부한다** (2026-09-20).
   *    다른 글의 근거로 이 글을 통과시키는 것이 가장 조용한 사고다.
   */
  const ev = findReviewArtifact({ target: targetOf(r), artifacts: ARTIFACTS })
  if (!ev.ok) return { personaCode: code, ageBand: band, ok: false, reason: ev.reason }
  return { personaCode: code, ageBand: band, ok: true, reason: '' }
}

const machine = rows.filter((r) => profileOf(r) === 'machine')
const pending = machine.filter((r) => !machineReviewedByHuman(r.decidedBy))
const reviewed = machine.filter((r) => machineReviewedByHuman(r.decidedBy))
const grounds = new Map(machine.map((r) => [r.id, groundOf(r)]))
const reviewable = pending.filter((r) => grounds.get(r.id)!.ok)
const blocked = pending.filter((r) => !grounds.get(r.id)!.ok)

console.log(`① 기계 후보 ${machine.length}건 — 🟢 검토 완료 ${reviewed.length} · 🟡 미검토 ${pending.length}`)
console.log(`   로컬 artifact ${ARTIFACTS.length}장 — 🔴 원문 근거는 DB 가 아니라 ${DATA_DIR} 에 있다`)
{
  /**
   * 🔴 **한 편당 비용을 여기서 내지 않는다** (2026-09-20 보정).
   *    분자(로컬 artifact 전부)와 분모(지금 미발행 READY)의 모집단이 다르다 —
   *    발행이 진행될수록 분모가 줄어 한 편당 비용이 끝없이 커진다.
   *    🔴 회차·기간·cohort 가 정해지기 전에는 **개별 비용만** 보여 준다.
   */
  const unsettled = ARTIFACTS.filter((a) => artifactCostUsd(a) === null).length
  console.log(`   🔴 회차·기간 cohort 가 정해지지 않아 **한 편당 비용을 내지 않는다**`)
  console.log(`      (개별 artifact 비용은 --id 로 한 건씩 본다`
    + `${unsettled > 0 ? ` · 🔴 정산 미상 ${unsettled}장` : ''})`)
}
console.log(`   미검토 중  검토 가능 ${reviewable.length}건 · 🔴 근거 없어 검토 불가 ${blocked.length}건`)
if (blocked.length > 0) {
  const why = new Map<string, number>()
  for (const r of blocked) { const w = grounds.get(r.id)!.reason; why.set(w, (why.get(w) ?? 0) + 1) }
  for (const [w, n] of why) console.log(`      · ${w} — ${n}건`)
}

// ── 한 건 전문 ──
if (ONLY_ID !== '') {
  const hit = rows.find((x) => x.id === ONLY_ID)
  if (hit === undefined) { await prisma.$disconnect(); fail(`대기열에 없는 id 다 — ${ONLY_ID}`) }
  const r: AutoRow = hit
  const g = grounds.get(r.id)
  console.log(`\n② 후보 ${r.id}`)
  console.log(`   profile ${profileOf(r) ?? '(불명)'} · status ${r.status} · decidedBy ${r.decidedBy ?? '(없음)'}`)
  console.log(`   승인 ${kst(r.decidedAt)} · 생성 ${kst(r.createdAt)}`)
  console.log(`   생성 voice Persona ${g?.personaCode ?? '🔴 기록 없음'} · 나이대 ${g?.ageBand ?? '🔴 모름'}`)
  console.log(`\n   제목: ${r.title}`)
  console.log(`   본문:\n${r.body.split('\n').map((x) => `     ${x}`).join('\n')}`)
  /**
   * 🔴 **사람이 판단할 근거를 함께 보여 준다** — 원문 근거 · Persona·stance ·
   *    원문에 없는 것 · 사라진 것 · 생활사 모순 · 기계 사유 · 정산액.
   */
  const tgt = targetOf(r)
  const cur = currentText(tgt)
  /**
   * 🔴 **사람이 읽어야 하는 것은 수정본이다** (2026-09-20). 위에 찍은 `r.title`/`r.body`
   *    는 큐가 고른 현재 글이고, 아래는 **무엇이 기계 것이고 무엇이 사람 것인지**다.
   */
  if (cur.edited) {
    console.log(`\n   ── 🔴 EDITED — 사람이 고친 글이다 (status ${r.status}) ──`)
    console.log('   [기계 최초 초안]')
    console.log(`     ${tgt.draftTitle}`)
    console.log(tgt.draftBody.split('\n').map((x) => `       ${x}`).join('\n'))
    console.log('   [사람 수정본 — 🔴 승인하려는 것은 이쪽이다]')
    console.log(`     ${cur.title}`)
    console.log(cur.body.split('\n').map((x) => `       ${x}`).join('\n'))
    console.log('   [무엇이 바뀌었나]')
    for (const line of editDiffLines(tgt)) console.log(`     ${line}`)
  }
  const ev = findReviewArtifact({ target: tgt, artifacts: ARTIFACTS })
  if (ev.ok) {
    console.log('\n   ── 사람이 볼 근거 (로컬 artifact 정본 · DB 사본 아님) ──')
    for (const line of reviewEvidenceLines(ev.artifact)) console.log(`   ${line}`)
    if (cur.edited) {
      console.log('   🔴 위 근거는 **기계 최초 초안**에 대한 것이다 —'
        + ' 사람 수정본은 사람이 직접 읽고 판단한다')
    }
  } else {
    console.log(`\n   🔴 근거를 찾지 못했다 — ${ev.reason}`)
  }
  if (g !== undefined && !g.ok) console.log(`\n   🔴 검토 완료 불가 — ${g.reason}`)
} else {
  console.log('\n② 검토 대기 (오래 기다린 순 · 상위 10건)')
  for (const [i, r] of reviewable.slice(0, 10).entries()) {
    const g = grounds.get(r.id)!
    console.log(`   ${i + 1}. ${r.id} · ${g.personaCode}(${g.ageBand}) · ${kst(r.decidedAt ?? r.createdAt)}`)
    console.log(`      "${r.title.slice(0, 46)}"`)
  }
  if (reviewable.length === 0) console.log('   (없음)')
}

// ── 여기까지가 read-only ──
if (!APPLY) {
  console.log('\n  🟡 read-only 입니다. DB write 0 —'
    + ' 검토 완료로 표시하려면 --id <id> --apply --limit=1 을 함께 붙이세요.\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── --apply — 🔴 decidedBy 한 칸만 바꾼다 ──
if (ONLY_ID === '') { await prisma.$disconnect(); fail('--apply 는 --id 와 함께만 씁니다. 한 번에 1건입니다.') }
if (LIMIT !== 1) { await prisma.$disconnect(); fail(`--limit 은 1 이어야 합니다 (받은 값 ${LIMIT ?? '없음'})`) }
const found = rows.find((x) => x.id === ONLY_ID)
if (found === undefined) { await prisma.$disconnect(); fail(`대기열에 없는 id 다 — ${ONLY_ID}`) }
const target: AutoRow = found
if (profileOf(target) !== 'machine') {
  await prisma.$disconnect(); fail('기계 후보가 아닙니다 — 사람 후보의 decidedBy 를 바꾸지 않습니다.')
}
if (machineReviewedByHuman(target.decidedBy)) {
  await prisma.$disconnect(); fail('이미 검토 완료된 후보입니다.')
}
const g = grounds.get(target.id)!
if (!g.ok) {
  await prisma.$disconnect()
  fail(`검토 완료할 수 없습니다 — ${g.reason}.`
    + ' 글쓴이 나이를 모르면 나이 관점을 본 것이 아니므로 "사람이 봤다" 고 적지 않습니다.')
}

const before = snapOf.get(target.id)
if (before === undefined) { await prisma.$disconnect(); fail('검토 스냅샷을 읽지 못했습니다.') }

/**
 * 🔴 **검증과 기록이 한 트랜잭션 안에 있다** (2026-09-20 보정).
 *
 *    앞판은 조건부 UPDATE 로 도장을 먼저 찍고 **그 뒤에** 다시 읽어 대조했다.
 *    대조가 어긋나면 종료 코드 1 로 멈췄지만 **도장은 이미 남아 있었다** —
 *    "검증 실패인데 `decidedBy`/`decidedAt` 가 남는" 상태다.
 *    🔴 이제 읽기·검증·기록·재대조가 한 경계 안이고, 어느 단계든 어긋나면 **되돌아간다.**
 *
 * 🔴 판정 자체는 `src/lib/original-post-machine-review.ts` 의 순수 함수가 한다 —
 *    여기서는 Prisma 를 그 계약에 끼워 넣기만 한다. fixture 는 같은 함수를 돌린다.
 */
const SELECT = {
  status: true, createdPostId: true, decidedBy: true, decidedAt: true, updatedAt: true,
  draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
  promptVersion: true, model: true, gateResults: true,
} as const

const reviewedAt = new Date()
const verdict = await completeReview({
  id: target.id, before, decidedBy: MACHINE_REVIEWED_BY, now: reviewedAt,
  store: {
    transaction: async (fn) => prisma.$transaction(async (tx) => fn({
      read: async (id) => {
        const r = await tx.originalPostApprovalQueue.findUnique({ where: { id }, select: SELECT })
        return r === null ? null : {
          status: r.status, createdPostId: r.createdPostId, decidedBy: r.decidedBy,
          updatedAt: r.updatedAt, decidedAt: r.decidedAt,
          title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
          promptVersion: r.promptVersion, model: r.model, gateResults: r.gateResults,
        }
      },
      /** 🔴 조건부 기록 — `updatedAt` 이 다르면 0건이 되어 그대로 되돌아간다 */
      stamp: async (i) => (await tx.originalPostApprovalQueue.updateMany({
        where: {
          id: i.id,
          // 🔴 읽었을 때의 그 status — 그 사이 바뀌었으면 0건이 된다
          status: rawById.get(i.id)!.status,
          createdPostId: null,
          decidedBy: i.where.decidedBy, updatedAt: i.where.updatedAt,
        },
        data: { decidedBy: i.decidedBy, decidedAt: i.decidedAt },
      })).count,
    })),
  },
})

if (!verdict.ok) {
  await prisma.$disconnect()
  fail(`${verdict.reason}\n     🔴 아무것도 바꾸지 않았습니다 — 다시 읽고 검토해 주세요.`)
}

console.log(`\n✅ 검토 완료 — ${target.id}`)
console.log(`   decidedBy → ${MACHINE_REVIEWED_BY} · decidedAt → ${kst(reviewedAt)}`)
console.log(`     (옛 값: ${target.decidedBy ?? '(없음)'} · ${kst(target.decidedAt)} — 🔴 기계 적재 시각이었다)`)
console.log('   🔴 검증과 기록이 한 트랜잭션 안에서 끝났습니다 —'
  + ' 어긋났으면 도장도 남지 않습니다')
console.log('   🔴 본문 · 제목 · status · gateResults · Post · Comment · Persona 는 바뀌지 않았습니다\n')
await prisma.$disconnect()
process.exit(0)
