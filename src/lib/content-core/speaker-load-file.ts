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
}

/**
 * 🔴 파일을 못 읽으면 **회차 안 중복만** 막는 값으로 돌아간다.
 *    `openDays: 1` 은 "이 회차에서 한 편까지" 라는 뜻이고,
 *    `readyCount: 0` 은 "재고를 모른다" 가 아니라 **빼지 않는다**는 뜻이다 —
 *    🔴 모르는 것을 0 으로 **단정하지 않기 위해** describe 에 적는다.
 */
export function readSpeakerLoad(raw: unknown): SpeakerLoadReader {
  const f = parseLoad(raw)
  if (f === null) {
    return {
      openDaysOf: () => 1,
      readyCountOf: () => 0,
      loaded: false,
      describe: '🔴 화자 여력 파일을 읽지 못했다 — 이 회차 안 중복만 막는다'
        + ' (날짜별 여력·기존 재고는 반영되지 않았다)',
    }
  }
  return {
    openDaysOf: (code) => f.byCode[code]?.openDays ?? 0,
    readyCountOf: (code) => f.byCode[code]?.readyCount ?? 0,
    loaded: true,
    describe: `🟢 화자 여력 ${Object.keys(f.byCode).length}명 · 지평 ${f.horizonDays}일`
      + ` · 기록 ${f.writtenAt}`,
  }
}
