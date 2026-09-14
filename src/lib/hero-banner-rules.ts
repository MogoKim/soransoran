/**
 * 홈 히어로 배너 — 순수 규칙.
 *
 * 🔴 DB 를 모른다. 표본 데이터만으로 확인할 수 있어야 한다
 *    (home-exposure-rules.ts · popularity.ts 와 같은 원칙).
 *    조회는 queries 가, 저장은 actions 가 한다. 여기는 판정만 한다.
 *
 * 🔴 규칙을 두 곳에 적지 않는다. 어드민 입력칸(브라우저) · 서버 액션 · 홈 조회 ·
 *    검증 스크립트가 **전부 이 파일 하나**를 부른다.
 *    같은 질문에 화면과 서버가 다른 답을 하는 순간이 사고다.
 *
 * 🔴 server-only 를 붙이지 않는다. 브라우저가 부르지 못하면
 *    어드민 화면이 자기만의 검사를 또 적게 된다 — 그것이 두 곳이 되는 경로다.
 *
 * 🔴 이 파일은 팝업 배너를 모른다. 홈 히어로 한 자리만 맡는다.
 *    type 필드로 두 종류를 한 모델에 담지 않는다 (설계 결정, 2026-09-14).
 */
import { BRAND_NAME } from '@/lib/brand-name'
import { safeHttpsUrl, safeInternalPath } from '@/lib/url-policy'

// ─────────── 상수 ───────────

/**
 * 같은 시각에 홈에 함께 나갈 수 있는 배너 수.
 *
 * 🔴 "isActive 인 행의 개수" 가 아니다. 어느 한 순간에 **실제로 겹치는** 수다.
 *    끝난 배너와 아직 시작 안 한 배너는 자리를 차지하지 않는다 — §validateHeroBannerCapacity.
 */
export const HERO_BANNER_MAX_CONCURRENT = 5

/** 2장 이상일 때 자동으로 넘어가는 간격. 🔴 실제 롤링 구현은 PR 3 이다. */
export const HERO_BANNER_ROTATION_MS = 7000

/**
 * 배너 이미지 규격.
 *
 * 🔴 실측에서 나온 값이다(2026-09-14 · production).
 *    홈 본문 폭은 max-w-3xl(768px)에서 멈춘다 — 1440px 모니터에서도 768px 이다.
 *    좁은 화면은 3:1, lg(1024px) 이상은 768×300(=2.56:1) 고정이다.
 *    권장 크기는 그 CSS 크기 × DPR 2 이고, 최소 크기는 × 1.5 다.
 *
 * 🔴 이미지 안에 카피가 들어간다. 시스템이 제목·부제를 합성하지 않는다 —
 *    그래서 비율이 어긋나면 crop 이 글자를 자른다. 오차를 넓게 둘 수 없다.
 */
export const HERO_BANNER_IMAGE_SPEC = {
  mobile: {
    label: '모바일',
    recommendedWidth: 1536,
    recommendedHeight: 512,
    minWidth: 1152,
    minHeight: 384,
    /** 3 : 1 */
    targetRatio: 3,
  },
  desktop: {
    label: '데스크탑',
    recommendedWidth: 1536,
    recommendedHeight: 600,
    minWidth: 1152,
    minHeight: 450,
    /** 2.56 : 1 — 768 : 300 과 같은 값이다 */
    targetRatio: 2.56,
  },
} as const

/** 목표 비율에서 벗어나도 되는 정도. ±1.5% */
export const HERO_BANNER_RATIO_TOLERANCE = 0.015

/**
 * 업로드로 받는 최대 크기.
 *
 * 🔴 4MB 다. Vercel 서버리스 요청 본문 상한이 4.5MB 라 그보다 크면
 *    우리 코드가 보기도 전에 잘린다 (post-media-policy.ts 와 같은 근거).
 */
export const HERO_BANNER_MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/**
 * 최종 저장 이미지의 **성능 목표**.
 *
 * 🔴 거부 기준이 아니다. 이 값을 넘겨도 업로드는 성공한다 —
 *    첫 화면 이미지라 가볍게 두자는 목표이지, 운영자가 배너를 못 올릴 이유가 아니다.
 *    (현재 정적 Hero 는 1920×1194 JPG 에 159KB 다 — 실측)
 */
export const HERO_BANNER_TARGET_STORED_BYTES = 300 * 1024

/**
 * 받는 형식.
 *
 * 🔴 GIF · HEIC · HEIF 를 받지 않는다. 회원 사진 업로드와 다른 판단이다 —
 *    저쪽은 아이폰으로 찍은 사진이 그대로 올라오는 자리라 HEIC 를 열어야 했다.
 *    여기는 운영자가 만든 제작물을 올리는 자리다. HEIC 가 올 이유가 없고,
 *    GIF 는 움직이는 이미지라 7초 자동 롤링과 부딪힌다.
 */
export const HERO_BANNER_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

// ─────────── 타입 ───────────

export type HeroBannerSlot = keyof typeof HERO_BANNER_IMAGE_SPEC

/**
 * 링크 종류.
 *
 * 🔴 Prisma enum 과 같은 문자열이다. Prisma 타입을 import 하지 않는다 —
 *    이 파일이 브라우저에서도 돌아야 하고, @prisma/client 는 그럴 수 없다.
 */
export type HeroBannerLinkKind = 'NONE' | 'INTERNAL' | 'EXTERNAL'

/** 판정을 통과한 링크. 렌더 방식이 kind 로 갈린다. */
export type HeroBannerLink =
  | { kind: 'NONE' }
  | { kind: 'INTERNAL'; href: string }
  | { kind: 'EXTERNAL'; href: string }

/** 규칙에 걸렸을 때. 🔴 error 는 운영자가 그대로 읽는 문장이다. */
export type HeroBannerRuleFailure = { error: string }

export type HeroBannerImageMetadata = {
  width: number
  height: number
  byteSize: number
  mimeType: string
}

export type HeroBannerScheduleInput = {
  startsAt: Date | null
  endsAt: Date | null
}

/** 활성화할 수 있는지 묻는 데 필요한 최소치. */
export type HeroBannerActivationInput = HeroBannerScheduleInput & {
  alt: string
  mobileImageKey: string | null
  desktopImageKey: string | null
  linkKind: HeroBannerLinkKind
  linkUrl: string | null
  archivedAt: Date | null
}

/** 지금 실제로 나가는지 묻는 데 필요한 최소치. */
export type HeroBannerRuntimeInput = HeroBannerActivationInput & {
  isActive: boolean
}

/** 순서를 정하는 데 필요한 최소치. */
export type HeroBannerOrderInput = {
  id: string
  sortOrder: number
}

/** 동시 노출 수를 세는 데 필요한 최소치. */
export type HeroBannerCapacityInput = HeroBannerRuntimeInput & { id: string }

/** 결과가 규칙 위반인가. */
export function isHeroBannerRuleFailure(
  value: unknown,
): value is HeroBannerRuleFailure {
  return typeof value === 'object' && value !== null && 'error' in value
}

// ─────────── 작은 도우미 ───────────

function isFilled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUsableDate(value: Date): boolean {
  return Number.isFinite(value.getTime())
}

// ─────────── 링크 ───────────

/**
 * 링크 종류와 값이 맞는지 보고, 맞으면 렌더에 쓸 형태로 돌려준다.
 *
 * 🔴 kind 와 값이 어긋나면 거부한다. "링크 없음" 인데 주소가 남아 있거나
 *    "내부" 인데 https 주소가 들어오면, 나중에 어느 쪽을 믿을지가 코드마다 갈린다.
 *
 * 🔴 내부 링크에 //evil.com 을 넣는 길을 막는다. "/" 로 시작하지만 밖으로 나간다 —
 *    판정은 url-policy.safeInternalPath 한 곳이 한다.
 *
 * 🔴 외부는 https 만이다. javascript: · data: · blob: · http: 전부 여기서 걸린다.
 */
export function resolveHeroBannerLink(
  kind: HeroBannerLinkKind,
  linkUrl: string | null | undefined,
): HeroBannerLink | HeroBannerRuleFailure {
  const raw = typeof linkUrl === 'string' ? linkUrl.trim() : ''

  if (kind === 'NONE') {
    if (raw.length > 0) {
      return { error: '링크 없음을 골랐는데 주소가 입력되어 있습니다. 주소를 비우거나 링크 종류를 바꿔 주세요.' }
    }
    return { kind: 'NONE' }
  }

  if (kind === 'INTERNAL') {
    // 🔴 서비스명을 직접 적지 않는다. 리브랜딩 때 이 자리가 옛 이름으로 남는다.
    if (raw.length === 0) {
      return { error: `${BRAND_NAME} 안의 주소를 입력해 주세요. 예: /community/free` }
    }
    const href = safeInternalPath(raw)
    if (!href) {
      return {
        error: `${BRAND_NAME} 안의 주소가 아닙니다. 슬래시로 시작하는 경로만 됩니다. 예: /community/free`,
      }
    }
    return { kind: 'INTERNAL', href }
  }

  if (kind === 'EXTERNAL') {
    if (raw.length === 0) return { error: '바깥 주소를 입력해 주세요. https 로 시작해야 합니다.' }
    const href = safeHttpsUrl(raw)
    if (!href) {
      return { error: '바깥 주소는 https 로 시작하는 것만 됩니다.' }
    }
    return { kind: 'EXTERNAL', href }
  }

  return { error: '알 수 없는 링크 종류입니다.' }
}

// ─────────── 예약 시각 (KST 입력 · UTC 저장) ───────────

/**
 * 🔴 home-exposure-rules.ts 의 KST_OFFSET_MS 와 같은 값이지만 그 파일을 고치지 않았다.
 *    그쪽 상수는 모듈 안에만 있고, 꺼내려면 기존 파일을 건드려야 한다 —
 *    홈 고정·숨김은 이번 PR 의 대상이 아니다.
 *    두 곳이 같은 값을 갖는 것은 알고 남긴다. 합칠 일이 생기면 그때 한 번에 옮긴다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** `YYYY-MM-DDTHH:mm` 또는 `YYYY-MM-DDTHH:mm:ss` */
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * 어드민이 고른 한국 시각 → 저장할 UTC Date. 못 읽으면 null.
 *
 * 🔴 브라우저의 시간대를 믿지 않는다. `new Date('2026-09-20T14:00')` 은
 *    **그 PC 의 시간대**로 해석된다 — 운영자가 해외에 있으면 몇 시간씩 어긋난다.
 *    그래서 입력 문자열을 그대로 받아 한국 시각으로 읽고 여기서 UTC 로 옮긴다.
 *    (home-exposure-rules.resolveExpiresAt 의 TODAY_KST 와 같은 방식이다)
 *
 * 🔴 2026-02-30 같은 날짜를 막는다. Date.UTC 는 그것을 3월 2일로 넘겨 **조용히 통과**시킨다.
 *    만든 값을 되돌려 읽어 입력과 같은지 확인한다.
 */
export function parseKstDateTimeLocal(value: string | null | undefined): Date | null {
  if (!value) return null
  const matched = DATETIME_LOCAL.exec(value.trim())
  if (!matched) return null

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const hour = Number(matched[4])
  const minute = Number(matched[5])
  const second = matched[6] === undefined ? 0 : Number(matched[6])

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  const asKstWallClock = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  const roundTrip = new Date(asKstWallClock)
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return null
  }

  return new Date(asKstWallClock - KST_OFFSET_MS)
}

/**
 * 저장된 UTC Date → 어드민 입력칸에 넣을 한국 시각 문자열. 값이 없으면 빈 문자열.
 *
 * 🔴 화면에 **읽히는** 표기는 admin-format.formatKst 가 한다(Intl · ko-KR).
 *    이 함수는 `<input type="datetime-local">` 이 요구하는 기계 형식 전용이다.
 *    둘은 목적이 달라 합치지 않는다.
 */
export function formatKstDateTimeLocal(value: Date | null | undefined): string {
  if (!value || !isUsableDate(value)) return ''
  const kst = new Date(value.getTime() + KST_OFFSET_MS)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return [
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`,
    `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
  ].join('T')
}

/**
 * 예약 시각이 말이 되는가.
 *
 * 🔴 넷 다 유효하다 — 시작만 · 종료만 · 둘 다 · 둘 다 없음.
 * 🔴 같은 시각은 거부한다. 구간이 [시작, 종료) 라 시작과 종료가 같으면
 *    **한순간도 노출되지 않는 배너**가 된다. 운영자는 그것을 예약이라고 생각한다.
 */
export function validateHeroBannerSchedule(
  schedule: HeroBannerScheduleInput,
): HeroBannerRuleFailure | null {
  const { startsAt, endsAt } = schedule

  if (startsAt && !isUsableDate(startsAt)) return { error: '시작 시각을 읽지 못했습니다.' }
  if (endsAt && !isUsableDate(endsAt)) return { error: '종료 시각을 읽지 못했습니다.' }

  if (startsAt && endsAt) {
    if (startsAt.getTime() === endsAt.getTime()) {
      return { error: '시작과 종료 시각이 같습니다. 종료는 시작보다 뒤여야 합니다.' }
    }
    if (startsAt.getTime() > endsAt.getTime()) {
      return { error: '종료 시각이 시작 시각보다 앞섭니다.' }
    }
  }

  return null
}

// ─────────── 이미지 규격 ───────────

/**
 * 올라온 이미지가 규격에 맞는가.
 *
 * 🔴 여기서 판정하는 것은 **metadata 뿐**이다. 파일이 진짜 그 형식인지는
 *    sharp 가 실제로 열어 봐야 안다 — 그 검사는 PR 2 의 업로드 endpoint 가 한다.
 *    선언된 MIME 은 보내는 쪽이 정하는 값이라 그것만으로 끝내지 않는다.
 *
 * 🔴 300KB 는 여기서 보지 않는다. 그것은 최종 저장물의 목표이지 거부 기준이 아니다.
 */
export function validateHeroBannerImageMetadata(
  slot: HeroBannerSlot,
  metadata: HeroBannerImageMetadata,
): HeroBannerRuleFailure | null {
  const spec = HERO_BANNER_IMAGE_SPEC[slot]
  const { width, height, byteSize, mimeType } = metadata

  const allowed: readonly string[] = HERO_BANNER_ALLOWED_MIME_TYPES
  if (!allowed.includes(mimeType)) {
    return { error: '사진 형식이 맞지 않아요. JPG · PNG · WebP 만 올릴 수 있어요.' }
  }

  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return { error: '사진을 읽지 못했어요. 다시 골라 주세요.' }
  }
  if (byteSize > HERO_BANNER_MAX_UPLOAD_BYTES) {
    return { error: '사진이 너무 커요. 4MB 이하로 골라주세요.' }
  }

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { error: '사진 크기를 읽지 못했어요. 다시 골라 주세요.' }
  }

  if (width < spec.minWidth || height < spec.minHeight) {
    return {
      error: `${spec.label} 이미지가 너무 작아요. ${spec.minWidth}×${spec.minHeight} 이상이어야 하고, ${spec.recommendedWidth}×${spec.recommendedHeight} 를 권합니다.`,
    }
  }

  const ratio = width / height
  const drift = Math.abs(ratio / spec.targetRatio - 1)
  if (drift > HERO_BANNER_RATIO_TOLERANCE) {
    return {
      error: `${spec.label} 이미지 비율이 맞지 않아요. ${spec.recommendedWidth}×${spec.recommendedHeight} 처럼 만들어 주세요.`,
    }
  }

  return null
}

// ─────────── 활성화와 노출 ───────────

/**
 * 켤 수 있는 배너인가. 켤 수 있으면 null, 아니면 이유.
 *
 * 🔴 이미지 두 장이 **모두** 있어야 한다. 한 장만으로 켜면 반대쪽 화면이 빈다.
 * 🔴 alt 가 없으면 켜지 않는다. 카피가 이미지 안에 들어가 있어서,
 *    alt 가 비면 화면을 읽어 주는 사람에게는 배너가 통째로 없는 것과 같다.
 * 🔴 보관한 배너는 켜지 않는다. 보관은 "이제 안 쓴다" 는 뜻이다.
 *
 * 🔴 이 함수는 **동시 노출 수를 보지 않는다.** 그것은 다른 배너들을 알아야 하는
 *    질문이라 validateHeroBannerCapacity 가 따로 답한다 — 섞으면 인자가 뒤엉킨다.
 */
export function canActivateHeroBanner(
  banner: HeroBannerActivationInput,
): HeroBannerRuleFailure | null {
  if (banner.archivedAt) return { error: '보관한 배너는 켤 수 없습니다. 먼저 보관을 풀어 주세요.' }
  if (!isFilled(banner.mobileImageKey)) return { error: '모바일 이미지를 올려 주세요.' }
  if (!isFilled(banner.desktopImageKey)) return { error: '데스크탑 이미지를 올려 주세요.' }
  if (!isFilled(banner.alt)) return { error: '이미지 설명을 입력해 주세요. 이미지 안의 글을 그대로 적어 주세요.' }

  const link = resolveHeroBannerLink(banner.linkKind, banner.linkUrl)
  if (isHeroBannerRuleFailure(link)) return link

  return validateHeroBannerSchedule(banner)
}

/**
 * 지금 이 순간 실제로 홈에 나가는 배너인가.
 *
 * 🔴 isActive 만으로 답하지 않는다. 운영자가 켠 것과 지금 나가는 것은 다른 질문이다 —
 *    예약 시작 전이거나 이미 끝난 배너는 켜져 있어도 나가지 않는다.
 *
 * 🔴 구간은 **[시작, 종료)** 다. 시작 시각에는 나가고, 종료 시각에는 나가지 않는다.
 *    그래서 앞 배너의 종료와 뒤 배너의 시작이 같은 값이면 둘은 겹치지 않는다.
 *
 * 🔴 시간 비교를 SQL 로 하지 않는다. 조회는 isActive · archivedAt 까지만 좁히고
 *    시각 판정은 여기 한 곳이 한다 — 두 곳이면 화면과 답이 갈라진다
 *    (queries/posts.ts 의 홈 노출 예외와 같은 원칙).
 */
export function isHeroBannerLive(
  banner: HeroBannerRuntimeInput,
  now: Date = new Date(),
): boolean {
  if (!banner.isActive) return false
  if (canActivateHeroBanner(banner) !== null) return false

  const at = now.getTime()
  if (banner.startsAt && banner.startsAt.getTime() > at) return false
  if (banner.endsAt && banner.endsAt.getTime() <= at) return false
  return true
}

// ─────────── 순서 ───────────

/**
 * 노출 순서. 작을수록 앞.
 *
 * 🔴 sortOrder 에 unique 를 걸지 않았다 — 자리를 맞바꾸는 중간 상태가 제약에 걸린다.
 *    그래서 같은 값이 있을 수 있고, 그때 순서가 흔들리지 않게 id 로 한 번 더 가른다.
 *    정렬 안정성에 기대지 않는다.
 *
 * 🔴 원본 배열을 건드리지 않는다.
 */
export function sortHeroBanners<T extends HeroBannerOrderInput>(banners: readonly T[]): T[] {
  return [...banners].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 지금 홈에 낼 배너들 — 정렬까지 마친 결과.
 *
 * 🔴 상한으로 한 번 더 자른다. 데이터가 어떤 이유로 6장이 되어도
 *    홈이 6장을 내보내지 않는다. 계약이 코드에서 끝나야 한다.
 *
 * 🔴 실제 홈 렌더는 PR 3 이다. 규칙만 여기 먼저 둔다.
 */
export function pickLiveHeroBanners<T extends HeroBannerRuntimeInput & HeroBannerOrderInput>(
  banners: readonly T[],
  now: Date = new Date(),
): T[] {
  const live = banners.filter((banner) => isHeroBannerLive(banner, now))
  return sortHeroBanners(live).slice(0, HERO_BANNER_MAX_CONCURRENT)
}

// ─────────── 동시 노출 상한 ───────────

type Interval = { start: number; end: number }

function toInterval(banner: HeroBannerScheduleInput): Interval {
  return {
    // 시작이 없으면 "옛날부터", 종료가 없으면 "계속" 이다.
    start: banner.startsAt ? banner.startsAt.getTime() : Number.NEGATIVE_INFINITY,
    end: banner.endsAt ? banner.endsAt.getTime() : Number.POSITIVE_INFINITY,
  }
}

/**
 * 구간들이 한 번에 가장 많이 겹치는 수.
 *
 * 시작에서 +1, 종료에서 -1 을 놓고 시간 순으로 훑는다(sweep line).
 *
 * 🔴 같은 시각에서는 **종료를 시작보다 먼저** 처리한다.
 *    구간이 [시작, 종료) 라 "3시에 끝나는 배너" 와 "3시에 시작하는 배너" 는 겹치지 않는다.
 *    시작을 먼저 더하면 그 한순간에만 1이 더 세어져, 겹치지도 않는 예약이 거부된다.
 *
 * 🔴 정렬에 뺄셈을 쓰지 않는다. 시작이 없는 배너가 둘이면 -Infinity 끼리 빼게 되어
 *    NaN 이 나오고, 정렬 결과가 엔진에 따라 달라진다. 부등호로 비교한다.
 */
function peakOverlap(intervals: readonly Interval[]): number {
  const events: { at: number; delta: number }[] = []
  for (const interval of intervals) {
    // 한순간도 열리지 않는 구간은 아무 자리도 차지하지 않는다.
    if (interval.start >= interval.end) continue
    events.push({ at: interval.start, delta: 1 })
    events.push({ at: interval.end, delta: -1 })
  }

  events.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    // -1(종료) 이 +1(시작) 보다 앞선다
    return a.delta - b.delta
  })

  let current = 0
  let peak = 0
  for (const event of events) {
    current += event.delta
    if (current > peak) peak = current
  }
  return peak
}

/**
 * 이 배너를 켜도(또는 이 예약 시간으로 바꿔도) 되는가.
 *
 * 🔴 활성 행의 개수를 세지 않는다. 그렇게 하면
 *      · 이미 끝난 배너
 *      · 아직 시작 안 한 배너
 *      · 기간이 서로 안 겹치는 배너
 *    때문에 새 배너를 켜지 못한다. 운영자는 이유를 알 수 없다.
 *
 *    정확한 계약은 이것이다 —
 *    **어느 시각에서도 동시에 나갈 수 있는 배너는 5장을 넘지 않는다.**
 *
 * 🔴 활성화와 예약 시간 수정이 **같은 판정**을 쓴다. 켤 때만 세면
 *    이미 켜진 배너의 기간을 넓혀 6장이 겹치게 만드는 길이 남는다.
 *
 * 🔴 PR 2 계약 — 이 함수는 반드시 쓰기와 **같은 트랜잭션 안**에서 불린다.
 *      · isolationLevel: 'Serializable'
 *      · 충돌(P2034)이면 제한된 횟수만 다시 시도한다
 *      · 그래도 충돌하면 운영자에게 "다시 시도해 주세요" 를 돌려준다
 *      · raw SQL · advisory lock 을 쓰지 않는다 (Raw SQL 금지 · CLAUDE.md)
 *    밖에서 세고 안에서 쓰면 두 운영자가 동시에 켤 때 6장이 나간다.
 *
 * @param candidate 켜려는(또는 기간을 바꾸려는) 배너. 바뀐 뒤의 값으로 넘긴다.
 * @param others    나머지 배너 전부. 여기서 자격 없는 것을 걸러 낸다.
 */
export function validateHeroBannerCapacity(input: {
  candidate: HeroBannerCapacityInput
  others: readonly HeroBannerCapacityInput[]
  max?: number
}): HeroBannerRuleFailure | null {
  const max = input.max ?? HERO_BANNER_MAX_CONCURRENT

  // 켤 수 없는 배너면 상한을 따지기 전에 그 이유가 먼저다.
  const blocked = canActivateHeroBanner(input.candidate)
  if (blocked) return blocked

  const rivals = input.others.filter(
    (banner) =>
      banner.id !== input.candidate.id &&
      banner.isActive &&
      canActivateHeroBanner(banner) === null,
  )

  const peak = peakOverlap([input.candidate, ...rivals].map(toInterval))
  if (peak > max) {
    return {
      error: `같은 시간에 노출되는 배너는 ${max}장까지입니다. 기간이 겹치는 배너를 먼저 끄거나 예약 시간을 조정해 주세요.`,
    }
  }

  return null
}
