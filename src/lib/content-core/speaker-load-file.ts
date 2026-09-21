/**
 * 화자 여력 파일 — 🔴 **DB 를 읽는 쪽과 글을 만드는 쪽을 잇는다** (2026-09-22)
 *
 * 🔴 **왜 파일인가.** 생성 러너(`micro-seed-auto-draft`)는 설계상 DB 를 쓰지 않는다 —
 *    파일만 읽고 파일만 쓴다. 그런데 "누가 며칠 뒤에 쓸 수 있는가" 와
 *    "이미 그 화자 글이 재고에 몇 편 있는가" 는 **DB 에만 있다.**
 *    공급 러너가 그 둘을 읽어 이 파일에 적고, 생성 러너가 읽는다.
 *
 * 🔴 **없으면 회차 안 중복만 막는다**(fail-safe). 파일이 없다고 생성을 멈추지 않는다 —
 *    멈추면 공급이 통째로 서고, 그것은 이 보정이 고치려는 문제보다 크다.
 *    🔴 다만 **그 사실을 적는다**. 조용히 "여력을 봤다" 고 하지 않는다.
 */
export const SPEAKER_LOAD_FILE = 'speaker-load.json'

export type SpeakerLoadRow = {
  /** 지평 안에서 이 화자가 배정 가능한 날 수 */
  openDays: number
  /** 이미 READY 재고에 있는 이 화자의 글 수 */
  readyCount: number
}
export type SpeakerLoadFile = {
  writtenAt: string
  /** 지평 일수 — 몇 일을 보고 센 값인가 */
  horizonDays: number
  byCode: Readonly<Record<string, SpeakerLoadRow>>
}

/** 🔴 모양을 손으로 확인한다 — 한 칸이라도 어긋나면 `null` 이다 */
function parseLoad(raw: unknown): SpeakerLoadFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.writtenAt !== 'string' || o.writtenAt === '') return null
  if (!Number.isInteger(o.horizonDays) || (o.horizonDays as number) < 1) return null
  if (typeof o.byCode !== 'object' || o.byCode === null) return null
  const byCode: Record<string, SpeakerLoadRow> = {}
  for (const [code, v] of Object.entries(o.byCode as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) return null
    const r = v as Record<string, unknown>
    if (!Number.isInteger(r.openDays) || (r.openDays as number) < 0) return null
    if (!Number.isInteger(r.readyCount) || (r.readyCount as number) < 0) return null
    byCode[code] = { openDays: r.openDays as number, readyCount: r.readyCount as number }
  }
  return { writtenAt: o.writtenAt, horizonDays: o.horizonDays as number, byCode }
}

export type SpeakerLoadReader = {
  openDaysOf: (code: string) => number
  readyCountOf: (code: string) => number
  /** 사람이 읽는 한 줄 — 🔴 파일이 없으면 그 사실이 여기 적힌다 */
  describe: string
  loaded: boolean
  /** 🔴 왜 못 읽었는가 — `loaded` 가 true 면 null */
  problem: 'missing' | 'malformed' | 'stale' | null
}

/**
 * 🔴 **여력 파일이 얼마나 오래되면 못 쓰는가.**
 *    재고와 배정은 회차마다 바뀐다 — 어제 값으로 오늘 화자를 나누면
 *    이미 재고를 채운 사람에게 또 몰아준다.
 */
export const SPEAKER_LOAD_MAX_AGE_MS = 6 * 60 * 60 * 1000

/**
 * 🔴 파일을 못 읽으면 **회차 안 중복만** 막는 값으로 돌아간다.
 *    `openDays: 1` 은 "이 회차에서 한 편까지" 라는 뜻이고,
 *    `readyCount: 0` 은 "재고를 모른다" 가 아니라 **빼지 않는다**는 뜻이다 —
 *    🔴 모르는 것을 0 으로 **단정하지 않기 위해** describe 에 적는다.
 */
export function readSpeakerLoad(raw: unknown, now: Date = new Date()): SpeakerLoadReader {
  const f = parseLoad(raw)
  const blocked = (problem: 'missing' | 'malformed' | 'stale', why: string): SpeakerLoadReader => ({
    openDaysOf: () => 1,
    readyCountOf: () => 0,
    loaded: false,
    problem,
    describe: `🔴 화자 여력을 쓸 수 없다 — ${why}`,
  })
  if (raw === null || raw === undefined) return blocked('missing', '파일이 없다')
  if (f === null) return blocked('malformed', '모양이 어긋난다')
  /**
   * 🔴 **오래된 파일은 없는 것과 같다.** 재고와 배정은 회차마다 바뀐다 —
   *    어제 값으로 오늘 화자를 나누면 이미 재고를 채운 사람에게 또 몰아준다.
   */
  const ageMs = now.getTime() - new Date(f.writtenAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > SPEAKER_LOAD_MAX_AGE_MS) {
    return blocked('stale', `기록이 오래됐다 (${f.writtenAt})`)
  }
  return {
    problem: null,
    openDaysOf: (code) => f.byCode[code]?.openDays ?? 0,
    readyCountOf: (code) => f.byCode[code]?.readyCount ?? 0,
    loaded: true,
    describe: `🟢 화자 여력 ${Object.keys(f.byCode).length}명 · 지평 ${f.horizonDays}일`
      + ` · 기록 ${f.writtenAt}`,
  }
}

/**
 * 🔴 **아직 배정되지 않은 READY 의 화자.** (2026-09-22)
 *
 *    갓 만들어진 후보는 `matchedPersona` 가 비어 있고, 누가 썼는지는
 *    `gateResults.autoDraft.voice.personaCode` 에만 있다.
 *    실측(2026-09-21): P01 글 2건이 둘 다 배정 전이라 재고에서 **한 건도
 *    세어지지 않았고**, 그래서 P01 이 여력이 가득한 것처럼 보였다.
 *
 * 🔴 모양이 아니면 `null` 이다 — 모르는 것을 아무에게나 얹지 않는다.
 */
export function draftSpeakerOf(gateResults: unknown): string | null {
  if (typeof gateResults !== 'object' || gateResults === null) return null
  const ad = (gateResults as Record<string, unknown>).autoDraft
  if (typeof ad !== 'object' || ad === null) return null
  const v = (ad as Record<string, unknown>).voice
  if (typeof v !== 'object' || v === null) return null
  const code = (v as Record<string, unknown>).personaCode
  return typeof code === 'string' && code.trim() !== '' ? code.trim() : null
}
