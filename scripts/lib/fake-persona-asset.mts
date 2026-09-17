/**
 * 🔴 **fixture 전용 합성 말투 자산** — 테스트에서만 부른다.
 *
 * 🔴 **왜 필요한가** (2026-09-17).
 *
 *    가짜 provider 행동 검사가 **개인 Mac 의 운영 자산**에 기대고 있었다.
 *    생성기는 말투 자산이 없으면 provider 를 부르기 **전에** 멈추므로,
 *    자산이 없는 CI 에서는 그 검사가 통째로 건너뛰어졌다 —
 *    그리고 "호출 0" 음성 검사가 **전부 공짜로 통과**했다.
 *
 * 🔴 **운영 자산을 읽지도 복사하지도 않는다.** 여기서 만드는 것은 전부 합성이다.
 *    실제 `$HOME` 도 건드리지 않는다 — 부르는 쪽이 임시 HOME 을 준다.
 *
 * 🔴 **자산 계약은 정본 상수·판정으로 충족한다.** 모양은 `judgeAssetShape` 가,
 *    판은 `ASSET_VERSION` 이, 권한은 `REFERENCE_*_MODE` 가 정한다.
 *    여기서 새 계약을 만들지 않는다.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ASSET_VERSION, REFERENCE_DIR_MODE, REFERENCE_FILE_MODE, SPEAKER_ID_PATTERN,
  judgeAssetShape, type AssetComment, type ReferenceAsset,
} from '../../src/lib/persona-reference-asset'
import { SANITIZER_VERSION } from '../../src/lib/persona-eval-invalidation'
import { REFERENCE_MIN_CHARS, REFERENCE_MIN_COUNT } from '../../src/lib/persona-voice-reference'

/** 🔴 정본 저장소와 같은 식 — 파일 원문의 digest 를 manifest 의 `sourceDigest` 로 쓴다 */
const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * 🔴 **경험을 주장하지 않는 문장만 쓴다.**
 *    `carriesExperience` 가 걸러 내면 그 댓글은 말투 근거가 되지 못하고,
 *    화자 수가 모자라 다시 "쓸 Persona 가 없다" 로 떨어진다.
 *    사연 없이 리듬만 있는 짧은 반응으로 채운다.
 */
const LINES: readonly string[] = [
  '그러게요 저도 비슷하게 느꼈어요',
  '음 어떻게 보면 그럴 수도 있겠네요',
  '아이고 그건 좀 그렇네요 ㅎㅎ',
  '맞아요 저도 같은 생각이에요',
  '그래도 다행이네요 잘 되셨으면',
  '흠 잘 모르겠지만 응원해요',
]

/** 화자 id — 🔴 정본 패턴(`[0-9a-f]{12}`)을 만족해야 한다 */
function speakerIdOf(n: number): string {
  const id = createHash('sha256').update(`fixture-speaker-${n}`).digest('hex').slice(0, 12)
  if (!SPEAKER_ID_PATTERN.test(id)) throw new Error(`합성 화자 id 가 정본 패턴에 안 맞는다: ${id}`)
  return id
}

export type FakeAssetPlan = {
  /** 임시 HOME — 🔴 실제 `$HOME` 을 주지 않는다 */
  home: string
  /** 화자 수. 기본 20 — Pool 카드 수보다 넉넉히 둔다 */
  speakers?: number
  /** 화자당 댓글 수. 🔴 정본 하한(`REFERENCE_MIN_COUNT`)보다 많아야 한다 */
  perSpeaker?: number
}

/**
 * 임시 HOME 아래에 합성 말투 자산을 쓴다 — 🔴 **경로·권한·모양을 정본대로.**
 *
 * 🔴 **실제 자산을 읽지 않는다.** manifest 에는 `readCanonAsset` 이 실제로 읽는
 *    `sourceDigest` 와, 사람이 볼 때 혼동하지 않도록 합성임을 밝히는 칸만 둔다.
 */
export function writeFakePersonaAsset(plan: FakeAssetPlan): {
  dir: string; corpus: string; manifest: string; comments: number
} {
  const speakers = plan.speakers ?? 20
  const perSpeaker = plan.perSpeaker ?? REFERENCE_MIN_COUNT + 1
  if (perSpeaker <= REFERENCE_MIN_COUNT) {
    throw new Error(`화자당 댓글이 정본 하한(${REFERENCE_MIN_COUNT}) 이하다 — 자산이 쓰이지 못한다`)
  }
  const comments: AssetComment[] = []
  for (let s = 0; s < speakers; s += 1) {
    const speakerId = speakerIdOf(s)
    for (let i = 0; i < perSpeaker; i += 1) {
      const content = `${LINES[(s + i) % LINES.length]!} (${s}-${i})`
      if (content.trim().length < REFERENCE_MIN_CHARS) {
        throw new Error(`합성 댓글이 정본 하한(${REFERENCE_MIN_CHARS}자)보다 짧다`)
      }
      comments.push({ speakerId, content })
    }
  }
  const asset: ReferenceAsset = {
    version: ASSET_VERSION,
    generatedAt: new Date('2026-09-17T00:00:00.000Z').toISOString(),
    comments,
  }
  // 🔴 **정본 판정으로 모양을 확인한 뒤에만 쓴다** — 틀린 자산을 만들어 두고
  //    "자산이 있는데 왜 안 되지" 로 헤매지 않는다
  const shape = judgeAssetShape(asset)
  if (!shape.ok) throw new Error(`합성 자산이 정본 모양이 아니다 [${shape.code}] ${shape.reason}`)

  const dir = join(plan.home, 'Library', 'Application Support', 'soransoran', 'persona-reference')
  mkdirSync(dir, { recursive: true, mode: REFERENCE_DIR_MODE })
  const corpus = join(dir, 'corpus.json')
  const manifest = join(dir, 'manifest.json')
  const raw = `${JSON.stringify(asset, null, 2)}\n`
  writeFileSync(corpus, raw, { encoding: 'utf-8', mode: REFERENCE_FILE_MODE })
  writeFileSync(manifest, `${JSON.stringify({
    // 🔴 `readCanonAsset` 이 실제로 읽는 칸은 이것 하나다
    sourceDigest: sha16(raw),
    sanitizerVersion: SANITIZER_VERSION,
    commentCount: comments.length,
    // 🔴 사람이 이 파일을 열었을 때 운영 자산과 헷갈리지 않게 한다
    note: 'fixture 합성 자산 — 운영 자산이 아니다',
  }, null, 2)}\n`, { encoding: 'utf-8', mode: REFERENCE_FILE_MODE })
  return { dir, corpus, manifest, comments: comments.length }
}
