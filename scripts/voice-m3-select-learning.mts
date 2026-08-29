#!/usr/bin/env tsx
/**
 * VE-M3-7 학습 데이터 선별 (읽기 전용)
 *
 * 정본: docs/operations/2026-08-29-voice-m3-export-design.md
 *       창업자 리뷰 — 대표 20건(20/20) · 표본 V40+R2 25(65/65)
 *
 * 🔴 **이 파일에는 유료 경로가 없다.**
 *    provider 를 import 하지 않고, `--apply` 도 `--confirm-paid-call` 도 받지 않는다.
 *    DB 는 **읽기만** 한다 — create · update · upsert · delete 가 한 줄도 없다.
 *
 * 🔴 두 트랙으로 나누는 이유
 *    처음엔 "학습 O / 제외" 한 축으로 봤다. 그래서 **7종 신호 만점급인데 남성 화자인 글이
 *    갈 곳이 없었다.** 목적을 나누면 그 글은 "말투는 못 쓰지만 사연 구조는 쓸 수 있는 글"이 된다.
 *      voice/style — 말투 · 리듬 · 감정 표현. 🔴 여성 화자만
 *      story/topic — 사건 구조 · 소재 · 전개. 화자 성별 무관(생성 시 일반화 전제)
 *
 * 🔴 expressionRisk 상한을 두지 않는다
 *    표본 R2(exp 36+) 25건 중 **20건(80%)이 voice/style 학습 O** 였고,
 *    65건 전체에서 "감정 강도 과함" 은 **0건**이었다.
 *    이 지표는 "위험" 이 아니라 **"감정 강도"** 를 재고 있고, 익명 커뮤니티에서 그것은 자산이다.
 *
 * 🔴 남성 화자는 여기서 확정하지 않는다
 *    notes 가 남성 화자를 명시한 건수는 **0건 / 9,411** 이다(여성 명시는 23건).
 *    모델은 화자 성별을 판정 대상으로 보지 않았다 — **자동 판정이 불가능하다.**
 *    그래서 `needsHumanSpeakerReview` 플래그로 **사람에게 넘긴다.**
 *    표본 추정 남성 비율은 약 10%(CI 4.3~20.3%).
 *
 * 사용법
 *   npm run voice:m3-select-learning              집계만 (파일 생성 0)
 *   npm run voice:m3-select-learning -- --write   tmp/voice-m3-learning/ 에 산출
 */
import { PrismaClient } from '@prisma/client'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  M3_ANALYSIS_MODEL, M3_SIGNAL_KEYS, M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION,
} from './lib/voice-m3-contract.mjs'
import { commentBodiesForLearning } from './lib/voice-unao-readonly.mjs'
import { stripWithLength } from './lib/voice-notice-strip.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { toCsv } from './lib/voice-m3-csv.mjs'

const argv = process.argv
const has = (n: string): boolean => argv.includes(`--${n}`)

const ELIGIBLE = 9444
const BOM = '﻿'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = join(HERE, '..', 'tmp', 'voice-m3-learning')

/**
 * 🔴 산출물 컬럼 화이트리스트 — 여기 없는 것은 나가지 않는다.
 *    원문 · 댓글 · 제목 · sourceUrl · cacheKey · contentHash · legacyLabels · authorHash 제외.
 *    나가는 것은 **길이 · 개수 · 점수 · bucket · flag** 뿐이다.
 */
const COLUMNS = [
  'sourceRef', 'sourceSite', 'bucket',
  'originalLength', 'cleanedLength', 'hadCafeNotice',
  'commentCount', 'commentBodyCount', 'replyCount',
  ...M3_SIGNAL_KEYS,
  'needsHumanSpeakerReview', 'hasIdentifyingDetail', 'isPrivateTopic', 'expRecovered',
] as const

export const FORBIDDEN_OUTPUT_KEYS = [
  'sourceUrl', 'content', 'topComments', 'author', 'errorMessage',
  'cacheKey', 'contentHash', 'legacyLabels', 'authorHash', 'title', 'notes',
] as const

// ── 판정 규칙 (notes 기반 — 모델이 남긴 판단 메모를 읽는다) ──
/** 🔴 회원이 쓴 글이 아닌 것. 점수와 무관하게 제외한다 */
const CONTAM = /뉴스 기사|기사 (전문|본문|원문)|신문식|광고성|마케팅 (템플릿|톤|문안)|홍보물|공고문|안내문|지자체|UI 요소|플레이어 UI|인터페이스|시스템 메시지|마크업|자막 설정|시 전문|시인의|판정 (대상으로 )?부적절|판정 불가|커뮤니티 글이 아|이벤트 (안내|공지)|입점 공지/
/** 식별 디테일 — 🔴 차단이 아니라 **일반화** 대상이다 */
const IDENT = /구체적인? (장소|지명|병원|회사|학교|날짜|시간대|시각)|실명|병원명|회사명|학교명|의료 (용어|정보)|고유명사|지명/
/** 사적 소재 — 🔴 위험이 아니라 **핵심 자산**이다 */
const TOPIC = /간병|돌봄|요양|병간호|치매|가족 갈등|시집|시댁|고부|남편|시어머니|이혼|신체 변화|갱년기|폐경|경제적|돈 (문제|걱정)|생활비|실직|외로움|고독|자존감|우울|일자리|재취업|퇴직|사건|사고|고민/
/** notes 가 여성 화자를 명시한 경우만 사람 확인을 면제한다 (실측 23건) */
const FEMALE = /여성 화자|화자가 여성|주부|아내의 시점|엄마의 시점/

type Row = {
  sourceRef: string; sourceSite: string; notes: string
  scores: Record<string, number>
  originalLength: number; cleanedLength: number; hadCafeNotice: boolean
  commentCount: number; commentBodyCount: number; replyCount: number
}

const BUCKETS = ['voice_style', 'story_topic', 'privacy_review', 'mimicry_review', 'excluded_contaminated', 'excluded_quality', 'neutral'] as const
type Bucket = (typeof BUCKETS)[number]

function classify(r: Row): { bucket: Bucket; expRecovered: boolean } {
  const s = r.scores
  // ① 오염 — 회원 글이 아니거나, 공지를 걷어내니 남는 본문이 없다
  if (CONTAM.test(r.notes) || r.cleanedLength === 0) return { bucket: 'excluded_contaminated', expRecovered: false }
  // ② 원문 모방 — 점수만으로 버리지 않는다. 사람이 본다
  if (s.sequenceSimilarityRisk >= 52) return { bucket: 'mimicry_review', expRecovered: false }
  // ③ 품질 — 🔴 expressionRisk 는 제외 사유가 아니다
  if (s.overSanitizedRisk >= 65 || s.overMimicryRisk >= 65 || s.voiceRetention <= 68) {
    return { bucket: 'excluded_quality', expRecovered: false }
  }
  const voiceOk = s.naturalnessScore >= 78 && s.voiceRetention >= 82 && s.originalityDelta >= 65
    && s.overSanitizedRisk <= 30 && s.overMimicryRisk <= 30 && s.sequenceSimilarityRisk <= 30
    && r.commentCount >= 4 && r.cleanedLength >= 300
  if (voiceOk) {
    // 식별 디테일이 있으면 버리지 않고 **일반화 대기열**로 보낸다
    if (IDENT.test(r.notes)) return { bucket: 'privacy_review', expRecovered: s.expressionRisk >= 36 }
    return { bucket: 'voice_style', expRecovered: s.expressionRisk >= 36 }
  }
  const storyOk = s.sequenceSimilarityRisk <= 35 && s.overMimicryRisk <= 45 && s.voiceRetention >= 68
    && s.originalityDelta >= 58 && (TOPIC.test(r.notes) || r.commentCount >= 10) && r.cleanedLength >= 200
  if (storyOk) return { bucket: 'story_topic', expRecovered: false }
  return { bucket: 'neutral', expRecovered: false }
}

async function main(): Promise<void> {
  await loadEnvLocal()
  const write = has('write')
  console.log('\nVE-M3-7 학습 데이터 선별 (읽기 전용)')
  console.log(`  모델 ${M3_ANALYSIS_MODEL} · task ${M3_TASK_VERSION} · prompt ${M3_PROMPT_VERSION}`)
  console.log('  🔴 유료 경로 0 · DB write 0 · provider import 0')
  console.log(`  모드 ${write ? '--write (tmp/voice-m3-learning/ 에 산출)' : '집계만 (파일 생성 0)'}\n`)

  const prisma = new PrismaClient()
  try {
    // ── 1. 분석 결과 (exact version) ──────────────
    const cache = await prisma.voiceM3Cache.findMany({
      where: {
        model: M3_ANALYSIS_MODEL, taskVersion: M3_TASK_VERSION,
        promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION, method: 'llm',
        status: 'succeeded',
      },
      select: { sourceRef: true, output: true },
    })
    const sources = await prisma.voiceSource.findMany({
      where: { sourceRef: { in: cache.map((c) => c.sourceRef) } },
      select: { sourceRef: true, sourceSite: true, commentCount: true },
    })
    const meta = new Map(sources.map((s) => [s.sourceRef, s]))
    console.log(`  분석 결과 ${cache.length}건 · 메타 ${sources.length}건`)

    // ── 2. 원문 — 🔴 길이 계산과 댓글 개수만 쓰고 버린다 ──
    const unao = new pg.Client({ connectionString: loadUnaoUrl(), ssl: { rejectUnauthorized: false } })
    await unao.connect()
    const rows: Row[] = []
    let noticeCount = 0
    try {
      const CHUNK = 500
      for (let i = 0; i < cache.length; i += CHUNK) {
        const part = cache.slice(i, i + CHUNK)
        const q = await unao.query<{ id: string; content: string | null; topComments: unknown }>(
          'SELECT id, content, "topComments" FROM "CafePost" WHERE id = ANY($1::text[])',
          [part.map((c) => c.sourceRef)],
        )
        const post = new Map(q.rows.map((r) => [r.id, r]))
        for (const c of part) {
          const p = post.get(c.sourceRef)
          // 🔴 원문은 이 블록 안에서만 산다. 길이·개수만 남기고 버린다
          const strip = stripWithLength(String(p?.content ?? ''))
          const bodies = commentBodiesForLearning(p?.topComments)
          const replies = Array.isArray(p?.topComments)
            ? (p.topComments as unknown[]).reduce<number>((a, it) => {
              const o = it as Record<string, unknown> | null
              return a + (Array.isArray(o?.replies) ? (o.replies as unknown[]).length : 0)
            }, 0)
            : 0
          if (strip.hadNotice) noticeCount += 1
          const o = c.output as Record<string, number | string>
          const m = meta.get(c.sourceRef)
          rows.push({
            sourceRef: c.sourceRef,
            sourceSite: (m?.sourceSite ?? 'unknown').replace('navercafe:', ''),
            notes: String(o.notes ?? ''),
            scores: Object.fromEntries(M3_SIGNAL_KEYS.map((k) => [k, Number(o[k])])),
            originalLength: strip.originalLength, cleanedLength: strip.cleanedLength, hadCafeNotice: strip.hadNotice,
            commentCount: m?.commentCount ?? 0, commentBodyCount: bodies.length, replyCount: replies,
          })
        }
        if ((i + CHUNK) % 2000 === 0) console.log(`     … ${Math.min(i + CHUNK, cache.length)}/${cache.length}`)
      }
    } finally {
      await unao.end()
    }

    // ── 3. 분류 ─────────────────────────────────
    const out = rows.map((r) => {
      const { bucket, expRecovered } = classify(r)
      const female = FEMALE.test(r.notes)
      return {
        sourceRef: r.sourceRef, sourceSite: r.sourceSite, bucket,
        originalLength: r.originalLength, cleanedLength: r.cleanedLength, hadCafeNotice: r.hadCafeNotice,
        commentCount: r.commentCount, commentBodyCount: r.commentBodyCount, replyCount: r.replyCount,
        ...Object.fromEntries(M3_SIGNAL_KEYS.map((k) => [k, r.scores[k]])),
        // 🔴 voice/style 계열만 사람이 화자를 확인해야 한다. 자동 판정은 불가능하다
        needsHumanSpeakerReview: (bucket === 'voice_style' || bucket === 'privacy_review') && !female,
        hasIdentifyingDetail: IDENT.test(r.notes),
        isPrivateTopic: TOPIC.test(r.notes),
        expRecovered,
      }
    })

    const tally = (b: Bucket): number => out.filter((r) => r.bucket === b).length
    console.log('\n  ── bucket ──')
    for (const b of BUCKETS) {
      const n = tally(b)
      if (n > 0) console.log(`     ${b.padEnd(22)} ${String(n).padStart(5)}건 (${(n / out.length * 100).toFixed(2)}%)`)
    }
    const voice = out.filter((r) => r.bucket === 'voice_style')
    const story = out.filter((r) => r.bucket === 'story_topic')
    const speakerReview = out.filter((r) => r.needsHumanSpeakerReview).length
    const dropped = rows.filter((r) => r.hadCafeNotice && r.originalLength >= 300 && r.cleanedLength < 300).length
    console.log('\n  ── 전처리 · 플래그 ──')
    console.log(`     카페 공지 포함 ${noticeCount}건 · 제거로 300자 미만 탈락 ${dropped}건 · 0자 ${rows.filter((r) => r.cleanedLength === 0).length}건`)
    console.log(`     🔴 화자 확인 필요 ${speakerReview}건 (voice/style + privacy)`)
    console.log(`     exp 36+ 회수분 ${out.filter((r) => r.expRecovered).length}건`)
    console.log(`     식별 디테일 ${out.filter((r) => r.hasIdentifyingDetail).length}건 · 사적 소재 ${out.filter((r) => r.isPrivateTopic).length}건`)
    console.log(`     댓글 본문 ${out.reduce((a, r) => a + r.commentBodyCount, 0).toLocaleString()}개 · 대댓글 ${out.reduce((a, r) => a + r.replyCount, 0).toLocaleString()}개(1차 보류)`)

    if (!write) {
      console.log('\n✅ 집계만 수행 — 생성된 파일 0. 산출하려면 `-- --write`\n')
      return
    }

    // ── 4. 산출 ─────────────────────────────────
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const dir = join(OUT_ROOT, stamp)
    mkdirSync(dir, { recursive: true })
    const files: Record<string, string> = {}
    const emit = (name: string, rowsOut: typeof out): void => {
      const csv = join(dir, `${name}.csv`)
      writeFileSync(csv, toCsv(COLUMNS, rowsOut as unknown as Array<Record<string, unknown>>, BOM), 'utf-8')
      files[`${name}.csv`] = csv
      const jsonl = join(dir, `${name}.jsonl`)
      writeFileSync(jsonl, rowsOut.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
      files[`${name}.jsonl`] = jsonl
    }
    emit('voice-style-candidates', voice)
    emit('story-topic-candidates', story)
    emit('review', out.filter((r) => r.bucket === 'privacy_review' || r.bucket === 'mimicry_review'))
    emit('excluded', out.filter((r) => r.bucket === 'excluded_contaminated' || r.bucket === 'excluded_quality'))

    const manifest = {
      generatedAt: new Date().toISOString(),
      model: M3_ANALYSIS_MODEL, taskVersion: M3_TASK_VERSION,
      promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
      population: { eligible: ELIGIBLE, analyzed: out.length },
      buckets: Object.fromEntries(BUCKETS.map((b) => [b, tally(b)])),
      preprocessing: {
        cafeNoticeStripped: noticeCount, droppedUnder300: dropped,
        zeroAfterStrip: rows.filter((r) => r.cleanedLength === 0).length,
        otherEmojiStripped: 0,
      },
      flags: {
        needsHumanSpeakerReview: speakerReview,
        expRecovered: out.filter((r) => r.expRecovered).length,
        hasIdentifyingDetail: out.filter((r) => r.hasIdentifyingDetail).length,
        isPrivateTopic: out.filter((r) => r.isPrivateTopic).length,
      },
      comments: {
        bodiesUsed: out.reduce((a, r) => a + r.commentBodyCount, 0),
        repliesHeldBack: out.reduce((a, r) => a + r.replyCount, 0),
        authorUsed: 0, likeCountUsed: 0,
      },
      columns: [...COLUMNS],
      sha256: {} as Record<string, string>,
    }
    for (const [n, p] of Object.entries(files)) {
      manifest.sha256[n] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
    const mp = join(dir, 'manifest.json')
    writeFileSync(mp, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
    files['manifest.json'] = mp

    // ── 5. 🔴 생성 후 금지 문자열 재검사 ──────────
    const offenders: string[] = []
    for (const [name, p] of Object.entries(files)) {
      const body = readFileSync(p, 'utf-8')
      for (const key of FORBIDDEN_OUTPUT_KEYS) {
        if (body.includes(`"${key}"`) || body.includes(`,${key},`) || body.startsWith(`${key},`)) {
          offenders.push(`${name} 에 금지 컬럼 ${key}`)
        }
      }
    }
    if (offenders.length > 0) {
      console.error(`\n🔴 금지 컬럼 검사 실패 — ${offenders.join(' / ')}`)
      process.exitCode = 1
      return
    }
    console.log(`\n  생성 위치 tmp/voice-m3-learning/${stamp}/`)
    for (const n of Object.keys(files)) console.log(`     ${n}`)
    console.log('\n  🔴 다음은 사람이 읽는다. 점수로 학습을 자동화하지 않는다.\n')
  } finally {
    await prisma.$disconnect()
  }
}

/** 🔴 우나어 read-only URL. 값은 어디에도 출력하지 않는다 */
function loadUnaoUrl(): string {
  const v = process.env.UNAO_READONLY_DATABASE_URL
  if (v === undefined || v === '') throw new Error('UNAO_READONLY_DATABASE_URL 없음')
  return v
}

main().catch((e: unknown) => {
  console.error(`\n🔴 선별 실패 — ${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
})
