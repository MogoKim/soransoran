/**
 * 말투 근거 **자산 로더** — 🔴 파일만 읽는다. DB · 네트워크 · AI 없음
 *
 * 🔴 **읽는 것은 댓글뿐이다.**
 *    자산 파일에는 원글 `body` 도 작성자 `author` 도 들어 있지만
 *    **여기서 꺼내는 것은 `comments[].content` 하나**다.
 *    창업자의 법률 판단은 공개 **댓글**에 관한 것이고,
 *    원글 본문 외부 전송 권한으로 확대 해석하지 않는다.
 *    `pickComments` 의 반환 타입에 본문·닉네임을 담을 자리가 **없다** —
 *    실수로 넣을 수 없게 타입으로 막는다.
 *
 * 🔴 **우나어 DB 에 접속하지 않는다.** 이 저장소 안에 이미 있는 artifact 만 읽는다.
 *    (`UNAO_READONLY_DATABASE_URL` 을 이 파일은 알지 못한다)
 *
 * 🔴 자산이 없으면 **비어 있음을 숨기지 않는다.** 가짜로 채우지 않고 blocker 로 낸다.
 */
import { existsSync, readFileSync } from 'node:fs'
import {
  judgeReferenceBundle, REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS,
  type VoiceReferenceBundle,
} from '../../src/lib/persona-voice-reference'

/** 🔴 소란소란 저장소 안의 자산. 경로가 바뀌면 여기만 고친다 */
export const REFERENCE_SOURCES: readonly string[] = [
  'tmp/voice-m3-review/_speaker-b1.json',
  'tmp/voice-m3-review/_sample-corpus.json',
]

export type ReferenceAssetReport = {
  path: string
  exists: boolean
  posts: number
  comments: number
}

/** 🔴 자산 파일의 한 항목 — **댓글만** 꺼낸다. body 는 타입에 없다 */
type CorpusRow = { comments?: unknown }

const contentOf = (c: unknown): string => {
  if (typeof c === 'string') return c
  if (c !== null && typeof c === 'object') {
    const o = c as { content?: unknown; body?: unknown; text?: unknown }
    for (const v of [o.content, o.body, o.text]) if (typeof v === 'string') return v
  }
  return ''
}

/**
 * 자산을 읽어 **댓글 문자열만** 모은다.
 * 🔴 순서를 고정한다 — 파일 순서 · 글 순서 · 댓글 순서. 무작위가 섞이면 재현되지 않는다.
 */
export function loadReferenceTexts(repoRoot: string): {
  texts: string[]
  assets: ReferenceAssetReport[]
} {
  const assets: ReferenceAssetReport[] = []
  const texts: string[] = []
  for (const rel of REFERENCE_SOURCES) {
    const path = `${repoRoot}/${rel}`
    if (!existsSync(path)) {
      assets.push({ path: rel, exists: false, posts: 0, comments: 0 })
      continue
    }
    const rows = JSON.parse(readFileSync(path, 'utf-8')) as CorpusRow[]
    let n = 0
    for (const row of Array.isArray(rows) ? rows : []) {
      const cs = row.comments
      if (!Array.isArray(cs)) continue
      for (const c of cs) {
        const t = contentOf(c).trim()
        // 🔴 여기서 길이 band 를 건다. 본문 판정은 judgeReferenceBundle 이 한 번 더 본다
        if (t === '') continue
        const len = [...t].length
        if (len < REFERENCE_MIN_CHARS || len > REFERENCE_MAX_CHARS) continue
        texts.push(t)
        n += 1
      }
    }
    assets.push({ path: rel, exists: true, posts: Array.isArray(rows) ? rows.length : 0, comments: n })
  }
  return { texts, assets }
}

/**
 * 🔴 **Persona 마다 서로 겹치지 않는 묶음으로 나눈다.**
 *
 *    같은 근거를 나눠 쓰면 어미만 다른 같은 문장이 나온다 —
 *    그것이 "댓글이 전부 비슷하다" 의 구조적 원인이다.
 *    그래서 **분할(partition)** 이지 표집(sampling)이 아니다. 겹치는 항목이 0 이다.
 *
 * 🔴 길이 분포를 유지한다. 짧은 것만 모으면 다시 "무조건 짧게" 가 된다 —
 *    길이순으로 늘어놓고 **번갈아** 나눠 담아 각 묶음이 짧은 것과 긴 것을 같이 갖게 한다.
 */
export function partitionByPersona(input: {
  texts: readonly string[]
  personaCodes: readonly string[]
  perPersona: number
}): { bundles: VoiceReferenceBundle[]; blocks: string[] } {
  const unique = [...new Set(input.texts.map((t) => t.trim()))].filter((t) => t !== '')
  // 🔴 길이순 정렬 후 라운드로빈 — 각 묶음이 분포 전체를 얻는다
  const sorted = unique.slice().sort((a, b) => [...a].length - [...b].length || a.localeCompare(b))
  const n = input.personaCodes.length
  const lanes: string[][] = input.personaCodes.map(() => [])
  for (let i = 0; i < sorted.length; i += 1) lanes[i % n]!.push(sorted[i]!)

  const bundles: VoiceReferenceBundle[] = []
  const blocks: string[] = []
  for (let i = 0; i < n; i += 1) {
    const code = input.personaCodes[i]!
    const lane = lanes[i]!
    /**
     * 🔴 **앞에서 자르지 않는다.** 레인은 길이순이라 앞을 자르면 **가장 짧은 것만** 남는다.
     *    실측으로 잡았다: 앞을 잘랐더니 열 묶음이 전부 `p25 5 · 중앙 5 · p90 6` 이 됐다 —
     *    그 근거를 주면 모델은 5자짜리만 쓴다. "무조건 짧게" 를 없애려다 되살릴 뻔했다.
     *    **레인 전체에 걸쳐 고르게 집는다.**
     */
    const step = lane.length / Math.max(1, input.perPersona)
    const take = lane.length <= input.perPersona
      ? lane.slice()
      : Array.from({ length: input.perPersona }, (_, k) => lane[Math.floor(k * step)]!)
    const v = judgeReferenceBundle({ personaCode: code, texts: take })
    if (!v.ok) { blocks.push(...v.blocks.map((b) => b.message)); continue }
    bundles.push(v.bundle)
  }
  return { bundles, blocks }
}

/**
 * 🔴 **생성 경로가 쓰는 단일 진입점.**
 *    자산을 읽고 Persona 별로 나눠 `Map` 으로 돌려준다.
 *    자산이 없으면 **빈 Map 과 blocker** 를 돌려준다 — 가짜로 채우지 않는다.
 */
export function bundlesForPersonas(input: {
  repoRoot: string
  personaCodes: readonly string[]
  perPersona?: number
}): {
  byCode: Map<string, VoiceReferenceBundle>
  assets: ReferenceAssetReport[]
  blocks: string[]
} {
  const { texts, assets } = loadReferenceTexts(input.repoRoot)
  if (texts.length === 0) {
    return {
      byCode: new Map(),
      assets,
      blocks: [`말투 근거 자산이 없다 — ${REFERENCE_SOURCES.join(' · ')}`],
    }
  }
  // 🔴 코드 순서를 고정한다. 호출 순서가 바뀌어도 같은 묶음이 나와야 재현된다
  const codes = [...new Set(input.personaCodes)].sort()
  const { bundles, blocks } = partitionByPersona({
    texts, personaCodes: codes, perPersona: input.perPersona ?? 12,
  })
  return { byCode: new Map(bundles.map((b) => [b.personaCode, b])), assets, blocks }
}
