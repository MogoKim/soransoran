/**
 * 수집 원천 목록 — 🔴 **카페마다 한 줄. 순수 함수 · 네트워크·DB·파일 0**
 *
 * 왜 이 파일이 있는가:
 *   카페 번호 · 게시판 · 하루 요청 수 · 호칭 낱말이 열 곳 넘게 흩어져 있어서 카페 하나를 더하려면
 *   코드 18곳을 고쳐야 했다. 카페를 더하는 일은 **이 배열에 한 줄 + 수집 계정 가입**이다.
 *   언제 도는가는 `cycle-schedule.ts` 의 `CYCLES` 가 정한다 — 여기에 시각을 적지 않는다.
 *
 * 🔴 지난 라운드에 뺀 후보(dlxogns01 · masanmam · goondae · yeowooya — 2026-09 "선택과 집중")는
 *    다시 쓰기로 정하면 한 줄을 넣는다. 실행 경로는 두지 않는다.
 */
import { CYCLES } from './cycle-schedule'

export type CollectSourceRow = {
  /** 네이버 카페 주소의 영문 id — `cafe.naver.com/{id}` */
  readonly id: string
  readonly label: string
  /** 신형 주소가 쓰는 숫자 카페 번호 */
  readonly cafeNo: string
  /** 읽는 게시판 하나 — `0` 은 전체글보기 */
  readonly menuId: string
  readonly boardLabel: string
  /**
   * 한 바퀴에 읽는 목록 쪽의 최대. 1쪽부터 읽고, 그 쪽이 전부 새 글이면 다음 쪽을 읽는다.
   * 🔴 쫑알은 1쪽(15행)이면 바퀴 몫을 고를 글이 다 들어온다 — 새 글을 다 보려면 하루 118쪽이라 불가능하고 필요도 없다.
   */
  readonly maxListPages: number
  /** 🔴 하루 요청 상한 — 남의 서버 부담의 천장(목록 · 본문 · 회원 확인 전부) */
  readonly dailyRequests: number
  /** 원출처 커뮤니티 호칭 — 소란소란 글에 그대로 남으면 옮겨 온 티가 난다(치환 대상) */
  readonly addressTerms: readonly string[]
}

export const COLLECT_SOURCES = [
  {
    id: 'remonterrace', label: '레몬테라스', cafeNo: '10298136',
    menuId: '23', boardLabel: '쫑알쫑알 게시판', maxListPages: 1,
    dailyRequests: 150, addressTerms: ['레테님들', '레테님'],
  },
  {
    id: 'wgang', label: '우아한 갱년기', cafeNo: '29349320',
    menuId: '0', boardLabel: '전체글보기', maxListPages: 3,
    dailyRequests: 150, addressTerms: ['우갱님들', '우갱님'],
  },
] as const satisfies readonly CollectSourceRow[]

export type CafeId = (typeof COLLECT_SOURCES)[number]['id']
export type SourceId = `navercafe:${CafeId}`
export type CollectSource = (typeof COLLECT_SOURCES)[number]

/**
 * 🔴 **수집 계정 하나의 하루 요청 상한 — 모든 카페 합.** 카페별 상한만 있으면 카페가 늘 때마다
 *    한 계정에서 나가는 양이 저절로 커진다(5곳이면 750). 보호장치가 요청마다 이 합도 본다.
 */
export const ACCOUNT_DAILY_REQUESTS = 300

/** 수집 job 하나 — 바퀴마다 원천 목록을 차례로 돈다 */
export const COLLECT_JOB_LABEL = 'com.soransoran.navercafe-collect'

/** 회차 시작 때 카페 홈 회원 확인 — 요청 1 */
export const MEMBER_CHECK_REQUESTS = 1

export const SOURCE_IDS: readonly SourceId[] = COLLECT_SOURCES.map((s) => sourceIdOf(s.id))

export function sourceIdOf(cafeId: CafeId): SourceId {
  return `navercafe:${cafeId}`
}

export function findSource(cafeId: string): CollectSource | null {
  return COLLECT_SOURCES.find((s) => s.id === cafeId) ?? null
}

export function sourceOfId(source: string): CollectSource | null {
  return COLLECT_SOURCES.find((s) => sourceIdOf(s.id) === source) ?? null
}

export function isSourceId(v: string): v is SourceId {
  return sourceOfId(v) !== null
}

/** 그 카페의 하루 요청 상한. 모르는 원천은 0 — 열지 않는다 */
export function dailyRequestsOf(source: string): number {
  return sourceOfId(source)?.dailyRequests ?? 0
}

/** 한 바퀴에서 본문 말고 쓰는 요청의 최대 — 회원 확인 + 목록 쪽 전부 */
export function overheadPerCycle(s: Pick<CollectSourceRow, 'maxListPages'>): number {
  return MEMBER_CHECK_REQUESTS + s.maxListPages
}

/** 하루 본문 상한(설정) — 13바퀴가 전부 목록을 끝까지 읽어도 남는 몫. 관측 산출이 아니다 */
export function detailCeilingPerDay(s: Pick<CollectSourceRow, 'maxListPages' | 'dailyRequests'>): number {
  return Math.max(0, s.dailyRequests - CYCLES.length * overheadPerCycle(s))
}

/** 수집 job 의 예약 시각 — 바퀴 표 그대로(`{hour, minute}` 모양을 읽는 관제 · 준비도용) */
export const COLLECT_SLOTS: readonly { hour: number; minute: number }[] =
  CYCLES.map((c) => ({ hour: Math.floor(c.minute / 60), minute: c.minute % 60 }))

/** KST 자정에서 센 분 */
export function kstMinuteOf(at: Date): number {
  const k = new Date(at.getTime() + 9 * 3_600_000)
  return k.getUTCHours() * 60 + k.getUTCMinutes()
}

/** 오늘(KST 날짜) 이 시각 뒤에 남은 바퀴 수 — 예산은 KST 자정에 돌아온다 */
export function cyclesAfterMinute(minute: number): number {
  return CYCLES.filter((c) => c.minute > minute).length
}

// ─────────────────────────────────────────────────────────
// 목록 — 앞 바퀴 뒤 새 글
// ─────────────────────────────────────────────────────────

/**
 * 앞 바퀴의 목록 표식 — 그 목록에서 가장 큰 글 번호와 목록을 읽은 시각.
 * 🔴 카페 글 번호는 카페 전체 일련번호라, 표식보다 큰 번호는 **그 목록을 읽은 뒤에 쓴 글**이다.
 *    번호로 게시 순서를 매기지는 않는다(그건 게시 시각이 한다) — 표식과의 대소만 본다.
 */
export type ListMark = { maxArticleId: number; listedAt: string }

export type ListRowLite = { sourceArticleId: string; sourcePinned?: boolean }

const idNum = (id: string): number => (/^\d+$/.test(id) ? Number(id) : Number.NaN)

/** 앞 바퀴 뒤에 올라온 글인가. 표식이 없으면 알 수 없다(false) */
export function isNewSince(row: ListRowLite, mark: ListMark | null): boolean {
  if (mark === null || row.sourcePinned === true) return false
  const n = idNum(row.sourceArticleId)
  return Number.isFinite(n) && n > mark.maxArticleId
}

/** 목록 줄들에서 표식을 만든다 — 고정 글은 오래된 공지라 빼고 센다 */
export function listMarkOf(rows: readonly ListRowLite[], listedAt: string): ListMark | null {
  const ids = rows.filter((r) => r.sourcePinned !== true).map((r) => idNum(r.sourceArticleId)).filter(Number.isFinite)
  return ids.length === 0 || Number.isNaN(Date.parse(listedAt)) ? null : { maxArticleId: Math.max(...ids), listedAt }
}

/**
 * 다음 쪽을 읽을까 — 이 쪽의 일반 글이 **전부** 새 글이면 그 뒤에도 새 글이 있을 수 있다.
 * 표식이 없으면(첫 회차) 최대 쪽까지 읽는다. 빈 쪽이면 멈춘다.
 */
export function readNextPage(input: { pageRows: readonly ListRowLite[]; mark: ListMark | null; page: number; maxPages: number }): boolean {
  if (input.page >= input.maxPages) return false
  const rows = input.pageRows.filter((r) => r.sourcePinned !== true)
  if (rows.length === 0) return false
  if (input.mark === null) return true
  return rows.every((r) => isNewSince(r, input.mark))
}

/**
 * 🔴 **게시 시각을 모르는 글의 하한** — 네이버는 어제 글에 날짜만 준다. 01:00 바퀴가 전날 22:20 뒤의 글을
 *    "어제 00:00 글"로 읽으면 최신순 맨 뒤로 밀리고 나이가 25시간이 된다. 앞 바퀴 뒤에 쓴 글이면
 *    앞 목록을 읽은 시각이 하한이다(지어낸 시각이 아니라 관측의 경계다). 날짜만 아는 글에만 붙인다.
 */
export function postedAfterOf(row: ListRowLite & { sourcePostedDay: string | null }, mark: ListMark | null): string | null {
  return row.sourcePostedDay !== null && isNewSince(row, mark) ? mark!.listedAt : null
}

// ─────────────────────────────────────────────────────────
// 바퀴 몫 — 하루 예산 안에서 새 글 수에 비례
// ─────────────────────────────────────────────────────────

/**
 * 오늘 남은 바퀴들이 볼 새 글의 예상 — **어제 같은 바퀴들이 실제로 본 새 글**.
 * 🔴 손으로 적은 시간대 표 대신 관측을 쓴다. 기록이 빠진 바퀴는 있는 바퀴 평균으로 채운다. 하나도 없으면 null.
 */
export function expectedLaterNew(history: readonly { minute: number; newSincePrevious: number }[], nowMinute: number): number | null {
  const later = CYCLES.filter((c) => c.minute > nowMinute)
  if (later.length === 0) return 0
  const seen = later.map((c) => history.find((h) => cycleOfMinute(h.minute) === c.minute)?.newSincePrevious)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  if (seen.length === 0) return null
  return (seen.reduce((a, b) => a + b, 0) * later.length) / seen.length
}

/** 그 분에 시작한 회차가 속한 바퀴의 시작 분 — 01:00 전은 전날 22:20 바퀴 */
function cycleOfMinute(minute: number): number {
  let hit = CYCLES[CYCLES.length - 1]!.minute
  for (const c of CYCLES) if (c.minute <= minute) hit = c.minute
  return hit
}

export type CycleQuotaInput = {
  dailyLimit: number
  /** 보호장치가 센 오늘 실제 사용량 — 이 바퀴의 회원 확인 · 목록까지 들어 있다 */
  usedToday: number
  accountLimit: number
  accountUsedToday: number
  /** 오늘 이 바퀴 뒤에 남은 바퀴 수 */
  cyclesAfter: number
  /** 남은 바퀴마다 쓰는 회원 확인 · 목록 요청의 최대(`overheadPerCycle`) */
  overheadPerCycle: number
  /** 앞 바퀴 뒤 새 글 — 목록에서 앞 바퀴가 이미 본 글을 뺀 수 */
  newCount: number
  /** 오늘 남은 바퀴들이 볼 새 글의 예상(`expectedLaterNew`). 모르면 null — 지금 바퀴만큼씩 본다고 본다 */
  expectedLater: number | null
}

export type CycleQuota = { quota: number; detailLeft: number; reserve: number; reason: string }

/**
 * 🔴 **이 바퀴에서 열 본문 수.** 남은 본문 예산(하루 상한 − 오늘 사용 − 남은 바퀴 몫)을
 *    "지금 새 글 : 남은 바퀴들이 볼 새 글" 비율로 나눈다. 새 글 수를 넘지 않는다.
 *    한 바퀴가 덜 쓰면 남은 몫은 다음 바퀴의 계산에 그대로 돌아간다.
 *    🔴 남은 바퀴마다 회원 확인 · 목록(최대) · 본문 1건을 먼저 떼어 둔다 — 앞 바퀴가 몫을 다 써도
 *       마지막 바퀴까지 새 글을 보고 하나는 열 수 있고, 13바퀴가 어떻게 돌아도 하루 상한을 넘지 않는다.
 */
export function cycleDetailQuota(i: CycleQuotaInput): CycleQuota {
  const budgetLeft = Math.max(0, Math.min(i.dailyLimit - i.usedToday, i.accountLimit - i.accountUsedToday))
  const reserve = Math.max(0, i.cyclesAfter) * (Math.max(0, i.overheadPerCycle) + 1)
  const detailLeft = Math.max(0, budgetLeft - reserve)
  const newCount = Math.max(0, Math.floor(i.newCount))
  const out = (quota: number, reason: string): CycleQuota => ({ quota, detailLeft, reserve, reason })
  if (newCount === 0) return out(0, '앞 바퀴 뒤 새 글 0')
  if (detailLeft === 0) return out(0, `남은 본문 예산 0 (남은 ${budgetLeft} · 남은 바퀴 몫 ${reserve})`)
  if (i.cyclesAfter <= 0) return out(Math.min(newCount, detailLeft), '오늘 마지막 바퀴 — 남은 예산을 다 쓴다')
  const later = i.expectedLater ?? newCount * i.cyclesAfter
  const share = Math.floor((detailLeft * newCount) / (newCount + Math.max(0, later)))
  return out(Math.min(newCount, detailLeft, Math.max(1, share)),
    `새 글 ${newCount} : 남은 바퀴 예상 ${Math.round(later)}${i.expectedLater === null ? '(어제 기록 없음 — 고르게)' : ''} · 남은 본문 ${detailLeft}`)
}
