#!/usr/bin/env tsx
/**
 * 홈 히어로 배너 계약 회귀 테스트.
 *
 * 🔴 DB 를 켜지 않는다. 네트워크도 쓰지 않는다.
 *    규칙이 순수 함수라 표본만으로 확인된다 —
 *    켜야 확인되는 테스트는 아무도 돌리지 않는다(home-exposure-check 와 같은 원칙).
 *
 * 🔴 규칙을 여기에 다시 적지 않는다. 원본을 그대로 import 한다.
 *    복사본은 반드시 원본과 어긋난다.
 *
 * 🔴 post-html.ts 를 import 하지 않는다. 그 파일은 `import 'server-only'` 라
 *    Next 런타임 밖에서 부르면 던진다. 대신
 *      ① 판정 알맹이(url-policy.safeHttpsUrl)를 직접 검증하고
 *      ② post-html 이 그것을 쓰고 있는지, safeLinkHref export 가 남아 있는지를
 *         소스 문자열로 확인한다.
 *    글 본문 링크의 동작이 바뀌지 않았음을 이 두 겹으로 지킨다.
 *
 * 이 테스트가 지키는 것
 *   ① 스키마 계약 — key 저장 · archive · 작성자 · index · 팝업 type 부재
 *   ② 이미지 규격 — 최소 크기 · 비율 ±1.5% · 4MB · 형식
 *   ③ 활성화 — 이미지 두 장 + alt + 링크 짝 + 예약
 *   ④ 예약 — [시작, 종료) 반개구간 · KST→UTC
 *   ⑤ 동시 노출 5장 — 활성 행 개수가 아니라 **겹치는 수**
 *   ⑥ 링크 보안 — 내부/외부/없음 · protocol-relative · 위험 scheme
 *
 * 사용법: npm run check:hero-banner
 * 종료 코드: FAIL 이 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HERO_BANNER_ALLOWED_MIME_TYPES,
  HERO_BANNER_IMAGE_SPEC,
  HERO_BANNER_MAX_CONCURRENT,
  HERO_BANNER_MAX_UPLOAD_BYTES,
  HERO_BANNER_RATIO_TOLERANCE,
  HERO_BANNER_ROTATION_MS,
  HERO_BANNER_TARGET_STORED_BYTES,
  HERO_BANNER_KEY_PREFIX,
  canActivateHeroBanner,
  formatKstDateTimeLocal,
  isHeroBannerLive,
  isHeroBannerRuleFailure,
  parseKstDateTimeLocalInput,
  pickLiveHeroBanners,
  resolveHeroBannerLink,
  resolveHeroBannerScheduleInput,
  sortHeroBanners,
  validateHeroBannerCapacity,
  validateHeroBannerDraft,
  validateHeroBannerImageKey,
  validateHeroBannerImageMetadata,
  validateHeroBannerSchedule,
  validateHeroBannerAlt,
  validateHeroBannerName,
  HERO_BANNER_MAX_ALT_LENGTH,
  HERO_BANNER_MAX_NAME_LENGTH,
  type HeroBannerCapacityInput,
  type HeroBannerOrderInput,
} from '../src/lib/hero-banner-rules'
import { HERO_BANNER_IMAGE_HOSTS, HERO_BANNER_IMAGE_PATH_PREFIX, heroBannerImageUrl } from '../src/lib/hero-banner-image'
import { ALLOWED_PUBLIC_ORIGINS, isOwnPublicUrl, publicUrlFromKey, toR2Key } from '../src/lib/r2-public'
import { safeHttpsUrl, safeInternalPath } from '../src/lib/url-policy'

let pass = 0
let fail = 0

function expect(label: string, actual: unknown, want: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(
    `  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`,
  )
  ok ? (pass += 1) : (fail += 1)
}

/** 규칙을 통과했는가 — 문구까지 고정하지 않는다. 문구는 다듬을 수 있어야 한다. */
function allowed(value: unknown): boolean {
  return value === null
}

/** 규칙에 걸렸는가. */
function denied(value: unknown): boolean {
  return isHeroBannerRuleFailure(value)
}

function at(iso: string): Date {
  return new Date(iso)
}

type Banner = HeroBannerCapacityInput & HeroBannerOrderInput

/** 아무 문제 없는 배너 한 장. 테스트마다 필요한 곳만 덮어쓴다. */
function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: 'b0',
    name: '가을 갱년기톡 안내',
    alt: '또래 셋이 웃으며 이야기하는 사진. "같이 이야기해요"',
    mobileImageKey: 'hero-banners/2026/aaa-mobile.webp',
    desktopImageKey: 'hero-banners/2026/aaa-desktop.webp',
    linkKind: 'NONE',
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    archivedAt: null,
    ...overrides,
  }
}

/**
 * 아직 이미지를 올리지 않은 비활성 초안.
 *
 * 🔴 이것이 저장 가능해야 한다. 첫 장만 올리고 저장하지 못하면
 *    R2 에 주인 없는 파일이 확정적으로 남는다.
 */
function incompleteDraft(overrides: Partial<Banner> = {}): Banner {
  return banner({
    id: 'draft',
    isActive: false,
    alt: '',
    mobileImageKey: null,
    desktopImageKey: null,
    ...overrides,
  })
}

/**
 * 예약 입력칸 하나를 읽은 결과를 한 줄로 만든다.
 *
 * 🔴 **비운 것과 잘못 적은 것이 다른 값으로 나와야 한다.**
 *    둘 다 null 이던 것이 결함 A 였다 — 잘못 적은 날짜가 "예약 없음" 으로 저장됐다.
 */
function readSchedule(raw: string | null | undefined): string {
  const result = parseKstDateTimeLocalInput(raw, '시작')
  if (isHeroBannerRuleFailure(result)) return 'ERROR'
  return result.value === null ? 'EMPTY' : result.value.toISOString()
}

/** 상시 노출 배너 n 장. 전부 조건을 갖추고 기간 제한이 없다. */
function alwaysOn(count: number, prefix = 'always'): Banner[] {
  return Array.from({ length: count }, (_, i) => banner({ id: `${prefix}${i}` }))
}

// ══════════════════════════════════════════════════════════
console.log('\n══════ 스키마 계약 (파일 읽기 · DB 연결 0)')

const ROOT = process.cwd()
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const migrationFile = readFileSync(
  join(ROOT, 'prisma/migrations/0025_hero_banner/migration.sql'),
  'utf8',
)
/**
 * 🔴 주석을 걷어 낸 **실행되는 SQL** 만 본다.
 *    머리말이 "DROP 은 창업자 승인 사항이다" 처럼 금지어를 설명하고 있어서,
 *    파일 전체를 훑으면 그 설명 문장이 위반으로 잡힌다.
 */
const migration = migrationFile
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const modelBody = /model HeroBanner \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? ''
expect('HeroBanner 모델이 있다', modelBody.length > 0, true)

const enumBody = /enum HeroBannerLinkKind \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? ''
expect(
  'linkKind enum 은 NONE · INTERNAL · EXTERNAL 셋이다',
  enumBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('/')),
  ['NONE', 'INTERNAL', 'EXTERNAL'],
)

for (const field of [
  'id',
  'name',
  'alt',
  'mobileImageKey',
  'desktopImageKey',
  'linkKind',
  'linkUrl',
  'sortOrder',
  'isActive',
  'startsAt',
  'endsAt',
  'archivedAt',
  'createdByUserId',
  'updatedByUserId',
  'createdAt',
  'updatedAt',
]) {
  expect(`모델에 ${field} 가 있다`, new RegExp(`\\n\\s+${field}\\s`).test(modelBody), true)
}

expect('이미지는 key 로 담는다 (URL 컬럼이 없다)', /ImageUrl/.test(modelBody), false)
expect('이미지 width 컬럼이 없다', /\n\s+(mobile|desktop)?[Ww]idth\s/.test(modelBody), false)
expect('이미지 height 컬럼이 없다', /\n\s+(mobile|desktop)?[Hh]eight\s/.test(modelBody), false)
expect('팝업용 type 필드가 없다', /\n\s+type\s/.test(modelBody), false)
expect('campaignId 를 미리 넣지 않았다', /campaignId/.test(modelBody), false)
expect('sortOrder 에 unique 를 걸지 않았다', /sortOrder\s+Int\s+@unique/.test(modelBody), false)
expect(
  'createdBy 는 SetNull 이다',
  /createdBy\s+User\?[^\n]*onDelete:\s*SetNull/.test(modelBody),
  true,
)
expect(
  'updatedBy 는 SetNull 이다',
  /updatedBy\s+User\?[^\n]*onDelete:\s*SetNull/.test(modelBody),
  true,
)
expect(
  '홈 조회용 복합 index 가 있다',
  /@@index\(\[isActive, archivedAt, sortOrder\]\)/.test(modelBody),
  true,
)
expect('startsAt index 가 있다', /@@index\(\[startsAt\]\)/.test(modelBody), true)
expect('endsAt index 가 있다', /@@index\(\[endsAt\]\)/.test(modelBody), true)
expect(
  'User 에 양쪽 역관계가 있다',
  /heroBannersCreated\s+HeroBanner\[\]/.test(schema) &&
    /heroBannersUpdated\s+HeroBanner\[\]/.test(schema),
  true,
)

console.log('\n── migration')
expect('신규 enum 을 만든다', /CREATE TYPE "HeroBannerLinkKind"/.test(migration), true)
expect('신규 테이블을 만든다', /CREATE TABLE "HeroBanner"/.test(migration), true)
expect(
  'index 3개를 만든다',
  (migration.match(/CREATE INDEX "HeroBanner_/g) ?? []).length,
  3,
)
expect(
  'FK 2개를 만든다 (둘 다 SET NULL)',
  (migration.match(/ON DELETE SET NULL/g) ?? []).length,
  2,
)
expect('기존 테이블을 ALTER 하지 않는다', /ALTER TABLE "(?!HeroBanner")/.test(migration), false)
expect('🔴 실행되는 SQL 에 DROP 이 없다 — down 자동화를 두지 않는다', /\bDROP\b/i.test(migration), false)
// 🔴 `ON DELETE SET NULL` 은 FK 정의의 일부라 여기 해당하지 않는다. 데이터를 지우는 문장만 본다.
expect(
  '데이터를 지우는 문장이 없다',
  /\b(TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i.test(migration),
  false,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 상수')

expect('동시 노출 상한은 5', HERO_BANNER_MAX_CONCURRENT, 5)
expect('롤링 간격은 7초', HERO_BANNER_ROTATION_MS, 7000)
expect('업로드 상한은 4MB', HERO_BANNER_MAX_UPLOAD_BYTES, 4 * 1024 * 1024)
expect('저장 목표는 300KB', HERO_BANNER_TARGET_STORED_BYTES, 300 * 1024)
expect('비율 오차는 ±1.5%', HERO_BANNER_RATIO_TOLERANCE, 0.015)
expect('받는 형식은 JPG · PNG · WebP 셋', [...HERO_BANNER_ALLOWED_MIME_TYPES], [
  'image/jpeg',
  'image/png',
  'image/webp',
])
expect('모바일 권장은 1536×512 · 비율 3', [
  HERO_BANNER_IMAGE_SPEC.mobile.recommendedWidth,
  HERO_BANNER_IMAGE_SPEC.mobile.recommendedHeight,
  HERO_BANNER_IMAGE_SPEC.mobile.targetRatio,
], [1536, 512, 3])
expect('데스크탑 권장은 1536×600 · 비율 2.56', [
  HERO_BANNER_IMAGE_SPEC.desktop.recommendedWidth,
  HERO_BANNER_IMAGE_SPEC.desktop.recommendedHeight,
  HERO_BANNER_IMAGE_SPEC.desktop.targetRatio,
], [1536, 600, 2.56])

// ══════════════════════════════════════════════════════════
console.log('\n══════ 이미지 규격')

const webp = { byteSize: 200 * 1024, mimeType: 'image/webp' }

expect(
  '모바일 권장 1536×512 통과',
  allowed(validateHeroBannerImageMetadata('mobile', { width: 1536, height: 512, ...webp })),
  true,
)
expect(
  '모바일 최소 1152×384 통과',
  allowed(validateHeroBannerImageMetadata('mobile', { width: 1152, height: 384, ...webp })),
  true,
)
expect(
  '모바일 최소 미달(1151×384) 차단',
  denied(validateHeroBannerImageMetadata('mobile', { width: 1151, height: 384, ...webp })),
  true,
)
expect(
  '모바일 높이 미달(1152×383) 차단',
  denied(validateHeroBannerImageMetadata('mobile', { width: 1152, height: 383, ...webp })),
  true,
)
expect(
  '데스크탑 권장 1536×600 통과',
  allowed(validateHeroBannerImageMetadata('desktop', { width: 1536, height: 600, ...webp })),
  true,
)
expect(
  '데스크탑 최소 1152×450 통과',
  allowed(validateHeroBannerImageMetadata('desktop', { width: 1152, height: 450, ...webp })),
  true,
)
expect(
  '데스크탑 최소 미달(1152×449) 차단 — 비율보다 크기가 먼저다',
  denied(validateHeroBannerImageMetadata('desktop', { width: 1152, height: 449, ...webp })),
  true,
)

console.log('\n── 비율 경계 (±1.5%)')
// 1536/519 = 2.9595… → 목표 3 대비 1.349% 벗어남 → 통과
expect(
  '모바일 1536×519 통과 (1.35% 벗어남)',
  allowed(validateHeroBannerImageMetadata('mobile', { width: 1536, height: 519, ...webp })),
  true,
)
// 1536/520 = 2.9538… → 1.538% 벗어남 → 거부
expect(
  '모바일 1536×520 차단 (1.54% 벗어남)',
  denied(validateHeroBannerImageMetadata('mobile', { width: 1536, height: 520, ...webp })),
  true,
)
// 1536/609 = 2.5222… → 목표 2.56 대비 1.476% → 통과
expect(
  '데스크탑 1536×609 통과 (1.48% 벗어남)',
  allowed(validateHeroBannerImageMetadata('desktop', { width: 1536, height: 609, ...webp })),
  true,
)
// 1536/610 = 2.5180… → 1.640% → 거부
expect(
  '데스크탑 1536×610 차단 (1.64% 벗어남)',
  denied(validateHeroBannerImageMetadata('desktop', { width: 1536, height: 610, ...webp })),
  true,
)
expect(
  '모바일 규격을 데스크탑 슬롯에 올리면 차단된다',
  denied(validateHeroBannerImageMetadata('desktop', { width: 1536, height: 512, ...webp })),
  true,
)

console.log('\n── 용량과 형식')
expect(
  '정확히 4MB 통과',
  allowed(
    validateHeroBannerImageMetadata('mobile', {
      width: 1536,
      height: 512,
      byteSize: HERO_BANNER_MAX_UPLOAD_BYTES,
      mimeType: 'image/jpeg',
    }),
  ),
  true,
)
expect(
  '4MB + 1바이트 차단',
  denied(
    validateHeroBannerImageMetadata('mobile', {
      width: 1536,
      height: 512,
      byteSize: HERO_BANNER_MAX_UPLOAD_BYTES + 1,
      mimeType: 'image/jpeg',
    }),
  ),
  true,
)
expect(
  '🔴 300KB 를 넘어도 통과한다 — 성능 목표이지 거부 기준이 아니다',
  allowed(
    validateHeroBannerImageMetadata('mobile', {
      width: 1536,
      height: 512,
      byteSize: HERO_BANNER_TARGET_STORED_BYTES + 1,
      mimeType: 'image/webp',
    }),
  ),
  true,
)
for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
  expect(
    `${mimeType} 허용`,
    allowed(
      validateHeroBannerImageMetadata('mobile', {
        width: 1536,
        height: 512,
        byteSize: 100 * 1024,
        mimeType,
      }),
    ),
    true,
  )
}
for (const mimeType of ['image/gif', 'image/heic', 'image/heif', 'image/svg+xml', 'text/plain']) {
  expect(
    `${mimeType} 차단`,
    denied(
      validateHeroBannerImageMetadata('mobile', {
        width: 1536,
        height: 512,
        byteSize: 100 * 1024,
        mimeType,
      }),
    ),
    true,
  )
}
expect(
  '크기를 읽지 못한 경우(0) 차단',
  denied(validateHeroBannerImageMetadata('mobile', { width: 0, height: 0, ...webp })),
  true,
)
expect(
  '소수점 크기 차단',
  denied(validateHeroBannerImageMetadata('mobile', { width: 1536.5, height: 512, ...webp })),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 활성화 조건')

expect('두 이미지 + alt 가 있으면 켤 수 있다', allowed(canActivateHeroBanner(banner())), true)
expect(
  '모바일 이미지가 없으면 못 켠다',
  denied(canActivateHeroBanner(banner({ mobileImageKey: null }))),
  true,
)
expect(
  '데스크탑 이미지가 없으면 못 켠다',
  denied(canActivateHeroBanner(banner({ desktopImageKey: null }))),
  true,
)
expect(
  '빈 문자열 key 는 없는 것으로 본다',
  denied(canActivateHeroBanner(banner({ mobileImageKey: '   ' }))),
  true,
)
expect('alt 가 없으면 못 켠다', denied(canActivateHeroBanner(banner({ alt: '' }))), true)
expect('alt 가 공백뿐이면 못 켠다', denied(canActivateHeroBanner(banner({ alt: '  ' }))), true)
expect(
  '보관한 배너는 못 켠다',
  denied(canActivateHeroBanner(banner({ archivedAt: at('2026-09-01T00:00:00.000Z') }))),
  true,
)
expect(
  '링크 짝이 안 맞으면 못 켠다',
  denied(canActivateHeroBanner(banner({ linkKind: 'NONE', linkUrl: 'https://x.com' }))),
  true,
)
expect(
  '예약이 뒤집혀 있으면 못 켠다',
  denied(
    canActivateHeroBanner(
      banner({ startsAt: at('2026-09-21T00:00:00.000Z'), endsAt: at('2026-09-20T00:00:00.000Z') }),
    ),
  ),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 예약 — 구간은 [시작, 종료)')

const START = at('2026-09-20T00:00:00.000Z')
const END = at('2026-09-25T00:00:00.000Z')
const scheduled = banner({ startsAt: START, endsAt: END })

expect('시작 1ms 전에는 나가지 않는다', isHeroBannerLive(scheduled, new Date(START.getTime() - 1)), false)
expect('시작 정각에는 나간다', isHeroBannerLive(scheduled, START), true)
expect('사이에는 나간다', isHeroBannerLive(scheduled, at('2026-09-22T12:00:00.000Z')), true)
expect('종료 1ms 전에는 나간다', isHeroBannerLive(scheduled, new Date(END.getTime() - 1)), true)
expect('🔴 종료 정각에는 나가지 않는다', isHeroBannerLive(scheduled, END), false)
expect('종료 뒤에는 나가지 않는다', isHeroBannerLive(scheduled, at('2026-09-26T00:00:00.000Z')), false)

expect(
  '시작만 있으면 그 뒤로 계속 나간다',
  isHeroBannerLive(banner({ startsAt: START }), at('2030-01-01T00:00:00.000Z')),
  true,
)
expect(
  '종료만 있으면 그 전에는 나간다',
  isHeroBannerLive(banner({ endsAt: END }), at('1999-01-01T00:00:00.000Z')),
  true,
)
expect('둘 다 없으면 늘 나간다', isHeroBannerLive(banner(), START), true)
expect('꺼져 있으면 나가지 않는다', isHeroBannerLive(banner({ isActive: false }), START), false)
expect(
  '보관한 배너는 켜져 있어도 나가지 않는다',
  isHeroBannerLive(banner({ archivedAt: START }), START),
  false,
)
expect(
  '이미지가 한 장뿐이면 켜져 있어도 나가지 않는다',
  isHeroBannerLive(banner({ desktopImageKey: null }), START),
  false,
)

console.log('\n── 시작·종료 유효성')
expect('둘 다 없음 허용', allowed(validateHeroBannerSchedule({ startsAt: null, endsAt: null })), true)
expect('시작만 허용', allowed(validateHeroBannerSchedule({ startsAt: START, endsAt: null })), true)
expect('종료만 허용', allowed(validateHeroBannerSchedule({ startsAt: null, endsAt: END })), true)
expect('시작 < 종료 허용', allowed(validateHeroBannerSchedule({ startsAt: START, endsAt: END })), true)
expect(
  '🔴 시작과 종료가 같으면 거부 — 한순간도 안 나가는 예약이다',
  denied(validateHeroBannerSchedule({ startsAt: START, endsAt: START })),
  true,
)
expect(
  '종료가 시작보다 앞서면 거부',
  denied(validateHeroBannerSchedule({ startsAt: END, endsAt: START })),
  true,
)
expect(
  '읽을 수 없는 시각은 거부',
  denied(validateHeroBannerSchedule({ startsAt: new Date('아무거나'), endsAt: null })),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ KST 입력 → UTC 저장')

// 🔴 기존 UTC 결과는 그대로 유지한다. 바뀐 것은 "빈 값" 과 "잘못된 값" 의 구분뿐이다.
expect('2026-09-20 14:00 KST = 05:00 UTC 같은 날', readSchedule('2026-09-20T14:00'), '2026-09-20T05:00:00.000Z')
expect('🔴 한국 아침 08:00 은 UTC 로 전날 23:00 이다', readSchedule('2026-09-20T08:00'), '2026-09-19T23:00:00.000Z')
expect('한국 자정 00:00 은 UTC 로 전날 15:00', readSchedule('2026-09-20T00:00'), '2026-09-19T15:00:00.000Z')
expect('초까지 준 경우도 읽는다', readSchedule('2026-09-20T14:00:30'), '2026-09-20T05:00:30.000Z')
expect('윤년 2월 29일은 읽는다', readSchedule('2028-02-29T12:00'), '2028-02-29T03:00:00.000Z')

console.log('\n── 🔴 빈 값과 잘못된 값은 다른 결과다 (결함 A)')
expect('빈 문자열은 "안 골랐다"', readSchedule(''), 'EMPTY')
expect('공백뿐인 값도 "안 골랐다"', readSchedule('   '), 'EMPTY')
expect('null 은 "안 골랐다"', readSchedule(null), 'EMPTY')
expect('undefined 는 "안 골랐다"', readSchedule(undefined), 'EMPTY')
expect('🔴 2026-02-30 은 오류다 — 3월로 미끄러지지도, 예약 없음이 되지도 않는다', readSchedule('2026-02-30T12:00'), 'ERROR')
expect('2026-02-29(평년) 오류', readSchedule('2026-02-29T12:00'), 'ERROR')
expect('13월 오류', readSchedule('2026-13-01T12:00'), 'ERROR')
expect('25시 오류', readSchedule('2026-09-20T25:00'), 'ERROR')
expect('60분 오류', readSchedule('2026-09-20T12:60'), 'ERROR')
expect('형식이 다르면 오류', readSchedule('2026/09/20 12:00'), 'ERROR')
expect('숫자가 아닌 값은 오류', readSchedule('내일 오후'), 'ERROR')
expect(
  '🔴 잘못된 값과 빈 값이 같은 결과가 아니다',
  readSchedule('2026-02-30T12:00') === readSchedule(''),
  false,
)

console.log('\n── 시작·종료 원시 입력을 한 번에 읽는다')
const bothEmpty = resolveHeroBannerScheduleInput({ startsAt: '', endsAt: null })
expect(
  '둘 다 비우면 예약 없음',
  isHeroBannerRuleFailure(bothEmpty) ? 'ERROR' : [bothEmpty.startsAt, bothEmpty.endsAt],
  [null, null],
)
const bothSet = resolveHeroBannerScheduleInput({
  startsAt: '2026-09-20T14:00',
  endsAt: '2026-09-25T09:00',
})
expect(
  '둘 다 주면 UTC 로 바뀐다',
  isHeroBannerRuleFailure(bothSet)
    ? 'ERROR'
    : [bothSet.startsAt?.toISOString(), bothSet.endsAt?.toISOString()],
  ['2026-09-20T05:00:00.000Z', '2026-09-25T00:00:00.000Z'],
)
expect(
  '🔴 시작이 잘못되면 그 자리에서 멈춘다 — null 로 바꿔 넘기지 않는다',
  denied(resolveHeroBannerScheduleInput({ startsAt: '2026-02-30T12:00', endsAt: null })),
  true,
)
expect(
  '종료가 잘못되면 오류',
  denied(resolveHeroBannerScheduleInput({ startsAt: null, endsAt: '2026-13-01T00:00' })),
  true,
)
expect(
  '시작과 종료가 같으면 오류',
  denied(
    resolveHeroBannerScheduleInput({ startsAt: '2026-09-20T14:00', endsAt: '2026-09-20T14:00' }),
  ),
  true,
)
expect(
  '종료가 시작보다 앞서면 오류',
  denied(
    resolveHeroBannerScheduleInput({ startsAt: '2026-09-25T14:00', endsAt: '2026-09-20T14:00' }),
  ),
  true,
)
expect(
  '시작만 주어도 통과',
  isHeroBannerRuleFailure(resolveHeroBannerScheduleInput({ startsAt: '2026-09-20T14:00', endsAt: '' })),
  false,
)
expect(
  '종료만 주어도 통과',
  isHeroBannerRuleFailure(resolveHeroBannerScheduleInput({ startsAt: null, endsAt: '2026-09-25T09:00' })),
  false,
)

const roundTrip = parseKstDateTimeLocalInput('2026-09-20T14:00', '시작')
expect(
  '되돌려 적으면 같은 한국 시각이 나온다',
  isHeroBannerRuleFailure(roundTrip) ? 'ERROR' : formatKstDateTimeLocal(roundTrip.value),
  '2026-09-20T14:00',
)
expect(
  '한국 날짜가 UTC 보다 하루 앞선 시각도 되돌아온다',
  formatKstDateTimeLocal(at('2026-09-19T23:00:00.000Z')),
  '2026-09-20T08:00',
)
expect('값이 없으면 빈 문자열', formatKstDateTimeLocal(null), '')
expect('읽을 수 없는 Date 는 빈 문자열', formatKstDateTimeLocal(new Date('아무거나')), '')

// ══════════════════════════════════════════════════════════
console.log('\n══════ 동시 노출 최대 5장 — 활성 행 수가 아니라 겹치는 수')

expect(
  '같은 시간 5장 허용',
  allowed(
    validateHeroBannerCapacity({ candidate: banner({ id: 'new' }), others: alwaysOn(4) }),
  ),
  true,
)
expect(
  '같은 시간 6장 거부',
  denied(
    validateHeroBannerCapacity({ candidate: banner({ id: 'new' }), others: alwaysOn(5) }),
  ),
  true,
)

const T0 = at('2026-09-20T00:00:00.000Z')
const T1 = at('2026-09-21T00:00:00.000Z')
const T2 = at('2026-09-22T00:00:00.000Z')

expect(
  '🔴 앞 배너의 종료와 뒤 배너의 시작이 같은 시각이면 겹치지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'next', startsAt: T1 }),
      others: [...alwaysOn(4), banner({ id: 'prev', endsAt: T1 })],
    }),
  ),
  true,
)
expect(
  '1ms 라도 겹치면 거부',
  denied(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'next', startsAt: new Date(T1.getTime() - 1) }),
      others: [...alwaysOn(4), banner({ id: 'prev', endsAt: T1 })],
    }),
  ),
  true,
)
expect(
  '🔴 이미 끝난 배너는 새 배너를 막지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new', startsAt: T1 }),
      others: Array.from({ length: 5 }, (_, i) => banner({ id: `done${i}`, endsAt: T0 })),
    }),
  ),
  true,
)
expect(
  '미래 예약끼리 겹치면 거부',
  denied(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new', startsAt: T1, endsAt: T2 }),
      others: Array.from({ length: 5 }, (_, i) =>
        banner({ id: `future${i}`, startsAt: T1, endsAt: T2 }),
      ),
    }),
  ),
  true,
)
expect(
  '미래 예약이 안 겹치면 허용',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new', startsAt: T1, endsAt: T2 }),
      others: Array.from({ length: 5 }, (_, i) =>
        banner({ id: `earlier${i}`, startsAt: T0, endsAt: T1 }),
      ),
    }),
  ),
  true,
)
expect(
  '🔴 기간을 넓혀 6장이 겹치게 되면 거부 — 켤 때만 세면 이 길이 남는다',
  denied(
    validateHeroBannerCapacity({
      // 원래 [T1, T2) 였던 배너를 상시로 넓힌다
      candidate: banner({ id: 'widen', startsAt: null, endsAt: null }),
      others: [
        ...alwaysOn(5, 'live'),
        banner({ id: 'widen', startsAt: T1, endsAt: T2 }),
      ],
    }),
  ),
  true,
)
expect(
  '같은 id 는 옛 값이 아니라 넘어온 새 값으로 센다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'me', startsAt: T1, endsAt: T2 }),
      others: [...alwaysOn(4), banner({ id: 'me', startsAt: null, endsAt: null })],
    }),
  ),
  true,
)
expect(
  '보관한 배너는 자리를 차지하지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new' }),
      others: Array.from({ length: 5 }, (_, i) => banner({ id: `arch${i}`, archivedAt: T0 })),
    }),
  ),
  true,
)
expect(
  '꺼진 배너는 자리를 차지하지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new' }),
      others: Array.from({ length: 5 }, (_, i) => banner({ id: `off${i}`, isActive: false })),
    }),
  ),
  true,
)
expect(
  '이미지가 덜 올라간 배너는 자리를 차지하지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new' }),
      others: Array.from({ length: 5 }, (_, i) =>
        banner({ id: `draft${i}`, desktopImageKey: null }),
      ),
    }),
  ),
  true,
)
expect(
  '켤 수 없는 배너는 상한을 따지기 전에 그 이유로 막힌다',
  denied(
    validateHeroBannerCapacity({ candidate: banner({ alt: '' }), others: [] }),
  ),
  true,
)
expect(
  '시작이 없는 배너 5장 + 종료가 없는 배너 1장도 6장이면 거부',
  denied(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new', endsAt: null }),
      others: Array.from({ length: 5 }, (_, i) => banner({ id: `open${i}`, startsAt: null })),
    }),
  ),
  true,
)
expect(
  '한순간도 열리지 않는 구간은 자리를 차지하지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'new' }),
      // startsAt === endsAt 는 canActivate 가 막으므로 others 에서 걸러진다
      others: Array.from({ length: 5 }, (_, i) =>
        banner({ id: `zero${i}`, startsAt: T1, endsAt: T1 }),
      ),
    }),
  ),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 🔴 비활성 초안은 capacity 에 막히지 않는다 (결함 B)')

expect(
  '비활성 + 이미지 없음 + alt 없음 → capacity 통과',
  allowed(validateHeroBannerCapacity({ candidate: incompleteDraft(), others: [] })),
  true,
)
expect(
  '비활성 초안 + 기존 활성 5장 → capacity 통과',
  allowed(validateHeroBannerCapacity({ candidate: incompleteDraft(), others: alwaysOn(5) })),
  true,
)
expect(
  '비활성 초안 + 겹치는 미래 예약 5장 → capacity 통과',
  allowed(
    validateHeroBannerCapacity({
      candidate: incompleteDraft({ startsAt: T1, endsAt: T2 }),
      others: Array.from({ length: 5 }, (_, i) =>
        banner({ id: `future${i}`, startsAt: T1, endsAt: T2 }),
      ),
    }),
  ),
  true,
)
expect(
  '이미 켜진 배너를 끄는 경우도 capacity 를 막지 않는다',
  allowed(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'turning-off', isActive: false }),
      others: alwaysOn(5),
    }),
  ),
  true,
)
expect(
  '🔴 같은 후보를 활성 상태로 바꾸면 이미지 누락으로 차단된다',
  denied(
    validateHeroBannerCapacity({ candidate: incompleteDraft({ isActive: true }), others: [] }),
  ),
  true,
)
expect(
  '🔴 이미지·alt 를 채워 활성화하면 이제 6장 겹침으로 차단된다',
  denied(
    validateHeroBannerCapacity({
      candidate: banner({ id: 'filled', isActive: true }),
      others: alwaysOn(5),
    }),
  ),
  true,
)

console.log('\n── 세 질문이 분리되어 있다')
expect('초안 저장은 가능하다', allowed(validateHeroBannerDraft(incompleteDraft())), true)
expect('그러나 켤 수는 없다', denied(canActivateHeroBanner(incompleteDraft())), true)
expect('그리고 자리는 차지하지 않는다', allowed(validateHeroBannerCapacity({ candidate: incompleteDraft(), others: alwaysOn(5) })), true)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 🔴 R2 이미지 key 검증 (결함 C)')

expect('key prefix 는 hero-banners/ 다', HERO_BANNER_KEY_PREFIX, 'hero-banners/')
expect(
  '정상 모바일 key 통과',
  allowed(validateHeroBannerImageKey('mobile', 'hero-banners/2026/ab12_CD-mobile.webp')),
  true,
)
expect(
  '정상 데스크탑 key 통과',
  allowed(validateHeroBannerImageKey('desktop', 'hero-banners/2026/ab12_CD-desktop.webp')),
  true,
)
expect(
  '🔴 회원 사진 자리(posts/) 차단',
  denied(validateHeroBannerImageKey('mobile', 'posts/user/image-mobile.webp')),
  true,
)
expect(
  '🔴 상위로 빠져나가는 경로 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/../other-mobile.webp')),
  true,
)
expect('점 두 개만 있어도 차단', denied(validateHeroBannerImageKey('mobile', '../other-mobile.webp')), true)
expect(
  '🔴 앞 슬래시 차단',
  denied(validateHeroBannerImageKey('mobile', '/hero-banners/2026/a-mobile.webp')),
  true,
)
expect(
  '🔴 역슬래시 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners\\2026\\a-mobile.webp')),
  true,
)
expect(
  '🔴 query 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a-mobile.webp?x=1')),
  true,
)
expect(
  '🔴 hash 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a-mobile.webp#a')),
  true,
)
expect(
  '🔴 제어문자 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a\u0000-mobile.webp')),
  true,
)
expect(
  '탭 문자 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a\tb-mobile.webp')),
  true,
)
expect(
  '앞뒤 공백이 붙은 key 차단',
  denied(validateHeroBannerImageKey('mobile', ' hero-banners/2026/a-mobile.webp ')),
  true,
)
expect(
  '🔴 데스크탑 key 를 모바일 슬롯에 넣으면 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a-desktop.webp')),
  true,
)
expect(
  '🔴 모바일 key 를 데스크탑 슬롯에 넣으면 차단',
  denied(validateHeroBannerImageKey('desktop', 'hero-banners/2026/a-mobile.webp')),
  true,
)
expect(
  '🔴 저장 확장자가 .jpg 면 차단 — 저장 결과는 언제나 WebP 다',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a-mobile.jpg')),
  true,
)
expect(
  '.png 도 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/a-mobile.png')),
  true,
)
expect(
  '연도 자리가 없으면 차단',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/a-mobile.webp')),
  true,
)
expect(
  '원본 파일명이 섞이면 차단 (한글·공백)',
  denied(validateHeroBannerImageKey('mobile', 'hero-banners/2026/내 사진-mobile.webp')),
  true,
)
expect('빈 key 차단', denied(validateHeroBannerImageKey('mobile', '')), true)
expect('null key 차단', denied(validateHeroBannerImageKey('mobile', null)), true)
expect('공백뿐인 key 차단', denied(validateHeroBannerImageKey('mobile', '   ')), true)

console.log('\n── 활성화가 key 검증을 실제로 쓴다')
expect(
  '🔴 posts/ key 로는 켤 수 없다',
  denied(canActivateHeroBanner(banner({ mobileImageKey: 'posts/user/a.webp' }))),
  true,
)
expect(
  '🔴 슬롯이 뒤바뀐 key 로는 켤 수 없다',
  denied(canActivateHeroBanner(banner({ mobileImageKey: 'hero-banners/2026/a-desktop.webp' }))),
  true,
)
expect(
  '잘못된 key 인 배너는 지금 나가지도 않는다',
  isHeroBannerLive(banner({ desktopImageKey: '../x-desktop.webp' }), T0),
  false,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 🔴 운영용 이름 (결함 D)')

expect('이름이 있으면 초안 저장 가능', allowed(validateHeroBannerDraft(banner())), true)
expect('🔴 빈 이름은 초안도 저장할 수 없다', denied(validateHeroBannerDraft(banner({ name: '' }))), true)
expect('공백뿐인 이름 차단', denied(validateHeroBannerDraft(banner({ name: '   ' }))), true)
expect(
  '이름만 있고 이미지가 없는 비활성 초안은 저장 가능',
  allowed(validateHeroBannerDraft(incompleteDraft({ name: '10월 배너 준비중' }))),
  true,
)
expect('🔴 이름 없는 배너는 켤 수 없다', denied(canActivateHeroBanner(banner({ name: '' }))), true)
expect(
  '이름 없는 배너는 지금 나가지도 않는다',
  isHeroBannerLive(banner({ name: '  ' }), T0),
  false,
)
expect(
  '초안 단계에서도 잘못된 링크는 막는다',
  denied(validateHeroBannerDraft(banner({ linkKind: 'INTERNAL', linkUrl: '//evil.com' }))),
  true,
)
expect(
  '초안 단계에서도 뒤집힌 예약은 막는다',
  denied(validateHeroBannerDraft(banner({ startsAt: T2, endsAt: T1 }))),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 순서')

expect(
  'sortOrder 오름차순',
  sortHeroBanners([
    banner({ id: 'c', sortOrder: 2 }),
    banner({ id: 'a', sortOrder: 0 }),
    banner({ id: 'b', sortOrder: 1 }),
  ]).map((b) => b.id),
  ['a', 'b', 'c'],
)
expect(
  '같은 sortOrder 는 id 로 가른다 — 정렬 안정성에 기대지 않는다',
  sortHeroBanners([
    banner({ id: 'z', sortOrder: 0 }),
    banner({ id: 'a', sortOrder: 0 }),
    banner({ id: 'm', sortOrder: 0 }),
  ]).map((b) => b.id),
  ['a', 'm', 'z'],
)
const original = [banner({ id: 'b', sortOrder: 1 }), banner({ id: 'a', sortOrder: 0 })]
sortHeroBanners(original)
expect('원본 배열을 건드리지 않는다', original.map((b) => b.id), ['b', 'a'])

expect(
  '지금 나가는 배너만 순서대로 고른다',
  pickLiveHeroBanners(
    [
      banner({ id: 'live2', sortOrder: 1 }),
      banner({ id: 'off', sortOrder: 0, isActive: false }),
      banner({ id: 'live1', sortOrder: 0 }),
      banner({ id: 'future', sortOrder: 0, startsAt: T2 }),
    ],
    T0,
  ).map((b) => b.id),
  ['live1', 'live2'],
)
expect(
  '🔴 데이터가 6장이 되어도 홈은 5장까지만 낸다',
  pickLiveHeroBanners(
    Array.from({ length: 6 }, (_, i) => banner({ id: `b${i}`, sortOrder: i })),
    T0,
  ).length,
  HERO_BANNER_MAX_CONCURRENT,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 링크 — 내부 경로')

expect('/community/free 허용', safeInternalPath('/community/free'), '/community/free')
expect('루트 허용', safeInternalPath('/'), '/')
expect('쿼리·해시 유지', safeInternalPath('/magazine?x=1#top'), '/magazine?x=1#top')
expect('경로를 정규화한다', safeInternalPath('/a/../b'), '/b')
expect('🔴 //evil.com 차단 — 슬래시로 시작하지만 밖으로 나간다', safeInternalPath('//evil.com'), null)
expect('///evil.com 차단', safeInternalPath('///evil.com'), null)
expect('🔴 역슬래시 차단', safeInternalPath('/\\evil.com'), null)
expect('경로 안 역슬래시도 차단', safeInternalPath('/community\\free'), null)
expect('절대 https 주소는 내부 경로가 아니다', safeInternalPath('https://evil.com/x'), null)
expect('슬래시 없이 시작하면 거부', safeInternalPath('community/free'), null)
expect('🔴 탭 문자 차단 — 파서가 지워 다른 경로가 된다', safeInternalPath('/com\tmunity'), null)
expect('개행 차단', safeInternalPath('/com\nmunity'), null)
expect('널문자 차단', safeInternalPath('/com\u0000munity'), null)
expect('javascript: 차단', safeInternalPath('javascript:alert(1)'), null)
expect('빈 값은 null', safeInternalPath(''), null)

console.log('\n── 링크 — 외부 https (post-html.safeLinkHref 와 같은 알맹이)')
expect('https 통과·정규화', safeHttpsUrl('https://example.com/a'), 'https://example.com/a')
expect('호스트만 주면 슬래시가 붙는다', safeHttpsUrl('https://example.com'), 'https://example.com/')
expect('http 차단', safeHttpsUrl('http://example.com'), null)
expect('javascript: 차단', safeHttpsUrl('javascript:alert(1)'), null)
expect('앞 공백이 있는 javascript: 차단', safeHttpsUrl(' javascript:alert(1)'), null)
expect('data: 차단', safeHttpsUrl('data:text/html,<script>x</script>'), null)
expect('blob: 차단', safeHttpsUrl('blob:https://example.com/x'), null)
expect('protocol-relative 차단', safeHttpsUrl('//evil.com'), null)
expect('상대경로 차단', safeHttpsUrl('/community/free'), null)
expect('주소가 아니면 차단', safeHttpsUrl('그냥 글자'), null)
expect('빈 값은 null', safeHttpsUrl(''), null)
expect('undefined 는 null', safeHttpsUrl(undefined), null)

console.log('\n── 링크 — 종류와 값의 짝')
expect('NONE + 빈 값 통과', resolveHeroBannerLink('NONE', null), { kind: 'NONE' })
expect('NONE + 공백뿐 통과', resolveHeroBannerLink('NONE', '   '), { kind: 'NONE' })
expect('🔴 NONE 인데 주소가 남아 있으면 거부', denied(resolveHeroBannerLink('NONE', 'https://x.com')), true)
expect(
  'INTERNAL + 내부 경로',
  resolveHeroBannerLink('INTERNAL', '/community/free'),
  { kind: 'INTERNAL', href: '/community/free' },
)
expect('INTERNAL + 앞뒤 공백도 읽는다', resolveHeroBannerLink('INTERNAL', '  /best  '), {
  kind: 'INTERNAL',
  href: '/best',
})
expect('INTERNAL + 빈 값 거부', denied(resolveHeroBannerLink('INTERNAL', '')), true)
expect('🔴 INTERNAL + //evil.com 거부', denied(resolveHeroBannerLink('INTERNAL', '//evil.com')), true)
expect('INTERNAL + 역슬래시 거부', denied(resolveHeroBannerLink('INTERNAL', '/\\evil.com')), true)
expect(
  '🔴 INTERNAL 인데 외부 주소면 거부',
  denied(resolveHeroBannerLink('INTERNAL', 'https://evil.com')),
  true,
)
expect(
  'EXTERNAL + https',
  resolveHeroBannerLink('EXTERNAL', 'https://example.com/a'),
  { kind: 'EXTERNAL', href: 'https://example.com/a' },
)
expect('EXTERNAL + 빈 값 거부', denied(resolveHeroBannerLink('EXTERNAL', '')), true)
expect('EXTERNAL + http 거부', denied(resolveHeroBannerLink('EXTERNAL', 'http://example.com')), true)
expect(
  'EXTERNAL + javascript: 거부',
  denied(resolveHeroBannerLink('EXTERNAL', 'javascript:alert(1)')),
  true,
)
expect('EXTERNAL + data: 거부', denied(resolveHeroBannerLink('EXTERNAL', 'data:text/html,x')), true)
expect('EXTERNAL + blob: 거부', denied(resolveHeroBannerLink('EXTERNAL', 'blob:https://x/y')), true)
expect('EXTERNAL + //evil.com 거부', denied(resolveHeroBannerLink('EXTERNAL', '//evil.com')), true)
expect(
  '🔴 EXTERNAL 인데 내부 경로면 거부',
  denied(resolveHeroBannerLink('EXTERNAL', '/community/free')),
  true,
)

// ══════════════════════════════════════════════════════════
console.log('\n══════ 글 본문 링크 회귀 (post-html)')

// 🔴 post-html.ts 는 server-only 라 여기서 import 하지 않는다. 소스로 확인한다.
const postHtml = readFileSync(join(ROOT, 'src/lib/post-html.ts'), 'utf8')
expect(
  'safeLinkHref export 가 그대로 있다',
  /export function safeLinkHref\(href: string \| undefined\): string \| null/.test(postHtml),
  true,
)
expect(
  '판정을 자기 안에 다시 적지 않고 url-policy 를 쓴다',
  /import \{ safeHttpsUrl \} from '@\/lib\/url-policy'/.test(postHtml) &&
    /return safeHttpsUrl\(href\)/.test(postHtml),
  true,
)
expect(
  'sanitize 의 링크 판정이 여전히 safeLinkHref 를 부른다',
  /const href = safeLinkHref\(attribs\.href\)/.test(postHtml),
  true,
)
expect('본문 외부 링크 rel 이 그대로다', /'nofollow noopener noreferrer'/.test(postHtml), true)
// 🔴 `import 'server-only'` 줄만 본다. 두 파일 모두 주석에서 그 말을 설명하고 있다.
expect(
  'url-policy 는 server-only 가 아니다 — 브라우저도 같은 판정을 본다',
  /^import 'server-only'/m.test(readFileSync(join(ROOT, 'src/lib/url-policy.ts'), 'utf8')),
  false,
)
expect(
  '규칙 파일도 server-only 가 아니다',
  /^import 'server-only'/m.test(readFileSync(join(ROOT, 'src/lib/hero-banner-rules.ts'), 'utf8')),
  false,
)

// ══════════════════════════════════════════════════════════
/**
 * 어드민 운영 계약 (PR 2).
 *
 * 🔴 순수 함수로 확인되는 것은 함수로 확인한다. 그러나 서버 액션·API 라우트는
 *    Next 런타임 밖에서 부를 수 없다(prisma · server-only · next/cache).
 *    그래서 **소스 문자열**로 계약을 지킨다 — 지키려는 것이
 *    "무엇을 부르는가 / 무엇을 절대 부르지 않는가" 이기 때문이다.
 *
 * 🔴 주석을 지운 뒤에 본다. 이 저장소의 주석에는 "삭제하지 않는다" 처럼
 *    금지어가 그대로 적혀 있어서, 지우지 않으면 설명문이 위반으로 잡힌다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const ACTIONS_SRC = readFileSync(join(ROOT, 'src/lib/actions/admin-hero-banner.ts'), 'utf8')
const ACTIONS = stripComments(ACTIONS_SRC)
const UPLOAD_SRC = readFileSync(
  join(ROOT, 'src/app/api/admin/hero-banners/upload/route.ts'),
  'utf8',
)
const UPLOAD = stripComments(UPLOAD_SRC)
const MEMBER_UPLOAD = stripComments(
  readFileSync(join(ROOT, 'src/app/api/uploads/route.ts'), 'utf8'),
)
const OPTIMIZE = stripComments(readFileSync(join(ROOT, 'src/lib/image-optimize.ts'), 'utf8'))
const NAV = stripComments(readFileSync(join(ROOT, 'src/components/admin/AdminOpsNav.tsx'), 'utf8'))
const NEXT_CONFIG = readFileSync(join(ROOT, 'next.config.js'), 'utf8')
const ENV_EXAMPLE = readFileSync(join(ROOT, '.env.example'), 'utf8')
const HOME_PAGE = stripComments(readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8'))

console.log('\n══════ 이름 · 설명 길이')

expect('이름 상한은 80자다', HERO_BANNER_MAX_NAME_LENGTH, 80)
expect('설명 상한은 150자다', HERO_BANNER_MAX_ALT_LENGTH, 150)
expect('보통 이름은 통과한다', allowed(validateHeroBannerName('10월 갱년기톡 안내')), true)
expect('빈 이름은 막힌다', denied(validateHeroBannerName('')), true)
expect('공백뿐인 이름은 막힌다', denied(validateHeroBannerName('   ')), true)
expect('80자 이름은 통과한다', allowed(validateHeroBannerName('가'.repeat(80))), true)
expect('81자 이름은 막힌다', denied(validateHeroBannerName('가'.repeat(81))), true)
expect(
  '앞뒤 공백은 길이에서 빠진다 — 공백 때문에 거부되지 않는다',
  allowed(validateHeroBannerName(`  ${'가'.repeat(80)}  `)),
  true,
)
expect('초안 이름이 81자면 저장도 막힌다', denied(validateHeroBannerDraft(banner({ name: '가'.repeat(81) }))), true)

expect('빈 설명은 저장 가능하다 — 초안에는 적을 근거가 없다', allowed(validateHeroBannerAlt('')), true)
expect('설명 null 도 저장 가능하다', allowed(validateHeroBannerAlt(null)), true)
expect('150자 설명은 통과한다', allowed(validateHeroBannerAlt('가'.repeat(150))), true)
expect('151자 설명은 막힌다', denied(validateHeroBannerAlt('가'.repeat(151))), true)
expect(
  '설명이 151자면 켤 수 없다',
  denied(canActivateHeroBanner(banner({ alt: '가'.repeat(151) }))),
  true,
)
expect(
  '설명이 150자면 켤 수 있다',
  allowed(canActivateHeroBanner(banner({ alt: '가'.repeat(150) }))),
  true,
)
expect(
  '설명이 비면 여전히 켤 수 없다 — 길이 규칙이 빈 값 규칙을 덮지 않는다',
  denied(canActivateHeroBanner(banner({ alt: '' }))),
  true,
)

console.log('\n══════ 어드민 권한 (우회 차단)')

/** export 된 서버 액션 이름 전부. 하나라도 빠지면 검사 자체가 헐거워진다. */
const ACTION_NAMES = [
  'createHeroBanner',
  'updateHeroBanner',
  'activateHeroBanner',
  'deactivateHeroBanner',
  'archiveHeroBanner',
  'restoreHeroBanner',
  'moveHeroBanner',
  'setHeroBannerImageKey',
]

const exported = [...ACTIONS.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
expect('알려진 액션 외에 export 된 함수가 없다', exported.sort(), [...ACTION_NAMES].sort())

for (const name of ACTION_NAMES) {
  /**
   * 🔴 함수 본문의 **첫 문장**이 requireAdmin 인지 본다.
   *    "어딘가에서 부른다" 로는 부족하다 — 조회를 먼저 하고 권한을 나중에 보면
   *    권한 없는 사람이 배너 존재 여부를 알아낼 수 있다.
   */
  const body = ACTIONS.split(`export async function ${name}(`)[1] ?? ''
  const firstStatement = body.slice(0, body.indexOf('\n\n') + 1)
  expect(
    `${name} 는 requireAdmin 을 가장 먼저 부른다`,
    /\{[\s\S]{0,200}?const \{ ok \} = await requireAdmin\(\)\s*\n\s*if \(!ok\) return DENIED/.test(
      firstStatement,
    ),
    true,
  )
}

expect(
  '업로드 라우트도 requireAdmin 을 가장 먼저 부른다 — 본문을 읽기 전이다',
  /export async function POST\(request: Request\) \{\s*const \{ ok \} = await requireAdmin\(\)\s*\n\s*if \(!ok\) return bad\(/.test(
    UPLOAD,
  ),
  true,
)
expect(
  '업로드 라우트가 requireAdmin 앞에서 formData 를 읽지 않는다',
  UPLOAD.indexOf('requireAdmin') < UPLOAD.indexOf('request.formData'),
  true,
)
expect(
  '업로드 라우트는 회원 경로(auth 세션)만으로 통과시키지 않는다',
  /from '@\/lib\/auth'/.test(UPLOAD),
  false,
)
expect('업로드는 nodejs 런타임이다 — sharp 가 edge 에서 돌지 않는다', /runtime = 'nodejs'/.test(UPLOAD), true)

console.log('\n══════ hard delete · R2 삭제 금지')

expect('액션에 prisma delete 가 없다', /\.delete\(|\.deleteMany\(/.test(ACTIONS), false)
expect('액션에 deleteFromR2 호출이 없다', /deleteFromR2/.test(ACTIONS), false)
expect('업로드 라우트에 deleteFromR2 호출이 없다', /deleteFromR2/.test(UPLOAD), false)
expect('업로드 라우트에 prisma delete 가 없다', /\.delete\(|\.deleteMany\(/.test(UPLOAD), false)
expect(
  '보관은 archivedAt 로 한다',
  /archivedAt: new Date\(\)/.test(ACTIONS) && /isActive: false/.test(ACTIONS),
  true,
)
expect('복원은 archivedAt 를 null 로 되돌린다', /archivedAt: null/.test(ACTIONS), true)
expect(
  '복원해도 자동으로 켜지 않는다 — isActive 를 true 로 되돌리지 않는다',
  /archivedAt: null, isActive: false/.test(ACTIONS),
  true,
)

console.log('\n══════ 동시성 (5장 · 순서)')

expect('활성화는 Serializable 트랜잭션을 쓴다', /isolationLevel: 'Serializable'/.test(ACTIONS), true)
expect('충돌(P2034)만 다시 시도한다', /error\.code === 'P2034'/.test(ACTIONS), true)
expect('재시도 횟수에 상한이 있다', /const SERIALIZABLE_RETRY = \d+/.test(ACTIONS), true)
expect(
  '상한 판정은 트랜잭션 client(tx)로 읽는다 — 전역 prisma 로 읽지 않는다',
  /async function assertCapacity\([\s\S]{0,400}?tx\.heroBanner\.findMany/.test(ACTIONS),
  true,
)
expect(
  '활성화가 capacity 를 센다',
  /activateHeroBanner[\s\S]*?await assertCapacity\(tx, candidate\)/.test(ACTIONS),
  true,
)
expect(
  '수정도 capacity 를 센다 — 기간을 넓혀 6장이 되는 길을 막는다',
  /updateHeroBanner[\s\S]*?await assertCapacity\(tx, candidate\)/.test(ACTIONS),
  true,
)
expect(
  '순서 이동은 0..n-1 로 다시 매긴다 — 동점이면 맞바꿔도 아무 일이 없다',
  /for \(const \[position, row\] of swapped\.entries\(\)\)/.test(ACTIONS),
  true,
)
expect(
  '순서 이동은 화면과 같은 정렬(sortHeroBanners)로 이웃을 고른다',
  /const ordered = sortHeroBanners\(rows\)/.test(ACTIONS),
  true,
)

console.log('\n══════ 이미지 업로드 계약')

expect('업로드는 R2 미설정이면 503 이다', /isR2Configured[\s\S]{0,300}?503/.test(UPLOAD), true)
expect('보관된 배너 업로드는 409 로 막는다', /archivedAt[\s\S]{0,200}?409/.test(UPLOAD), true)
expect('4MB 상한을 규칙 상수에서 가져온다', /HERO_BANNER_MAX_UPLOAD_BYTES/.test(UPLOAD), true)
expect('허용 형식을 규칙 상수에서 가져온다', /HERO_BANNER_ALLOWED_MIME_TYPES/.test(UPLOAD), true)
expect('규격 판정을 규칙 함수에 맡긴다', /validateHeroBannerImageMetadata\(slot,/.test(UPLOAD), true)
expect(
  '선언 MIME 이 아니라 sharp 가 읽은 실제 형식으로 판정한다',
  /sharp\(raw\)\.metadata\(\)/.test(UPLOAD) && /FORMAT_TO_MIME\[probe\.format\]/.test(UPLOAD),
  true,
)
expect(
  'EXIF 회전을 반영해 가로·세로를 잰다 — 세로로 찍은 사진이 비율에서 뒤집히지 않는다',
  /probe\.orientation/.test(UPLOAD),
  true,
)
/**
 * 🔴 import 줄이 아니라 **호출부** 순서를 본다.
 *    파일 첫머리의 import 는 언제나 맨 앞이라, 파일 전체에서 위치를 재면
 *    이 검사는 무엇을 하든 통과한다 — 그러면 검사가 있는 척만 하는 것이다.
 */
const UPLOAD_BODY = UPLOAD.split('export async function POST')[1] ?? ''
expect(
  '규격은 원본으로 잰다 — optimize 뒤에 재면 최소 크기 검사가 무의미해진다',
  UPLOAD_BODY.indexOf('validateHeroBannerImageMetadata(slot,') <
    UPLOAD_BODY.indexOf('await optimizeImage(raw,'),
  true,
)
expect(
  '두 호출이 모두 본문에 실제로 있다 — 없으면 위 비교가 -1 끼리라 의미가 없다',
  UPLOAD_BODY.includes('validateHeroBannerImageMetadata(slot,') &&
    UPLOAD_BODY.includes('await optimizeImage(raw,'),
  true,
)
expect('배너는 1536 / 82 로 저장한다', /STORED_MAX_EDGE = 1536/.test(UPLOAD) && /STORED_QUALITY = 82/.test(UPLOAD), true)
expect(
  'optimizeImage 에 배너 전용 값을 넘긴다',
  /optimizeImage\(raw, \{\s*maxEdge: STORED_MAX_EDGE,\s*quality: STORED_QUALITY,\s*\}\)/.test(UPLOAD),
  true,
)
expect(
  'key 는 hero-banners/{YYYY}/{uuid}-{slot}.webp 다',
  /`hero-banners\/\$\{new Date\(\)\.getUTCFullYear\(\)\}\/\$\{randomUUID\(\)\}-\$\{slot\}\.webp`/.test(
    UPLOAD,
  ),
  true,
)
expect('만든 key 를 규칙 함수로 한 번 더 본다', /validateHeroBannerImageKey\(slot, key\)/.test(UPLOAD), true)
expect('올린 파일명을 key 에 쓰지 않는다', /file\.name/.test(UPLOAD), false)
expect('업로드 성공 뒤 DB 에 key 를 반영한다', /setHeroBannerImageKey\(bannerId, slot, key\)/.test(UPLOAD), true)
expect('실패 원문을 화면에 넘기지 않는다', /error: \(error as Error\)\.message/.test(UPLOAD), false)
expect('실패 원인은 로그로만 남긴다', /console\.error\('\[hero-banner-upload\]/.test(UPLOAD), true)

console.log('\n══════ 회원 사진 업로드 무회귀')

expect('회원 기본 최대 변은 1200 이다', /const MAX_EDGE = 1200/.test(OPTIMIZE), true)
expect('회원 기본 품질은 80 이다', /const QUALITY = 80/.test(OPTIMIZE), true)
expect(
  '인자를 주지 않으면 기본값을 쓴다',
  /const maxEdge = options\.maxEdge \?\? MAX_EDGE/.test(OPTIMIZE) &&
    /const quality = options\.quality \?\? QUALITY/.test(OPTIMIZE),
  true,
)
expect(
  '회원 업로드는 optimizeImage 를 인자 없이 부른다 — 동작이 그대로다',
  /await optimizeImage\(raw\)/.test(MEMBER_UPLOAD),
  true,
)
expect('회원 업로드 key 자리는 그대로 posts/ 다', /`posts\/\$\{userId\}\//.test(MEMBER_UPLOAD), true)
expect('회원 업로드는 여전히 세션 로그인을 본다', /const session = await auth\(\)/.test(MEMBER_UPLOAD), true)

console.log('\n══════ 어드민 메뉴 · 경로')

expect("메뉴에 '/admin/banners' 가 있다", /href: '\/admin\/banners', label: '배너 관리'/.test(NAV), true)
expect('메뉴는 6개다', [...NAV.matchAll(/\{ href: '\/admin/g)].length, 6)
expect("메뉴에 '/admin/home' 이 그대로 있다", /href: '\/admin\/home'/.test(NAV), true)

console.log('\n══════ R2 공개 host · env')

expect(
  'next.config.js 와 코드가 같은 host 목록을 쓴다',
  HERO_BANNER_IMAGE_HOSTS.every((h) => NEXT_CONFIG.includes(`hostname: '${h}'`)),
  true,
)
expect(
  'pathname 을 /hero-banners/** 로 좁힌다',
  /pathname: '\/hero-banners\/\*\*'/.test(NEXT_CONFIG),
  true,
)
expect('와일드카드 host 를 쓰지 않는다', /hostname: '\*/.test(NEXT_CONFIG), false)
for (const key of [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY',
  'CLOUDFLARE_R2_SECRET_KEY',
  'CLOUDFLARE_R2_BUCKET',
  'NEXT_PUBLIC_R2_PUBLIC_URL',
]) {
  expect(`.env.example 에 ${key} 가 값 없이 있다`, new RegExp(`^${key}=$`, 'm').test(ENV_EXAMPLE), true)
}

// ══════════════════════════════════════════════════════════
/**
 * R2 공개 주소 전환 (dual-host).
 *
 * 🔴 지키려는 것은 하나다 — **이미 저장된 글의 사진이 사라지지 않는 것.**
 *    본문에는 옛 r2.dev 절대 URL 이 박혀 있고, 허용 주소를 새 것 하나로 바꾸면
 *    sanitize 가 `<img>` 를 태그째 지우고 thumbnailUrl 까지 비운다.
 *
 * 🔴 env 에 따라 달라지는 동작(publicUrlFromKey)은 env 를 잠깐 바꿔 끼워 확인한다.
 *    r2-public 이 **부를 때마다** 환경변수를 읽으므로 한 프로세스 안에서
 *    전환 전/후를 모두 볼 수 있다(withPublicUrl).
 */
const OLD_ORIGIN = 'https://pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev'
const NEW_ORIGIN = 'https://img.soransoran.com'

console.log('\n══════ R2 공개 주소 전환 — 허용 origin')

expect('허용 origin 은 정확히 2개다', ALLOWED_PUBLIC_ORIGINS.length, 2)
expect('옛 r2.dev origin 이 목록에 있다', ALLOWED_PUBLIC_ORIGINS.includes(OLD_ORIGIN as never), true)
expect('새 img origin 이 목록에 있다', ALLOWED_PUBLIC_ORIGINS.includes(NEW_ORIGIN as never), true)
expect(
  '와일드카드를 origin 문자열에 쓰지 않는다',
  ALLOWED_PUBLIC_ORIGINS.some((o) => o.includes('*')),
  false,
)

console.log('\n── isOwnPublicUrl · toR2Key 는 두 origin 을 모두 받는다')

const OLD_POST = `${OLD_ORIGIN}/posts/cmtabc/11111111-2222-3333-4444-555555555555.webp`
const NEW_POST = `${NEW_ORIGIN}/posts/cmtabc/11111111-2222-3333-4444-555555555555.webp`
const OLD_HERO = `${OLD_ORIGIN}/hero-banners/2026/aaa-mobile.webp`
const NEW_HERO = `${NEW_ORIGIN}/hero-banners/2026/aaa-mobile.webp`

expect('옛 posts URL 을 우리 것으로 본다', isOwnPublicUrl(OLD_POST), true)
expect('새 posts URL 을 우리 것으로 본다', isOwnPublicUrl(NEW_POST), true)
expect('옛 hero URL 을 우리 것으로 본다', isOwnPublicUrl(OLD_HERO), true)
expect('새 hero URL 을 우리 것으로 본다', isOwnPublicUrl(NEW_HERO), true)
expect('옛 URL 에서 key 를 뽑는다', toR2Key(OLD_POST), 'posts/cmtabc/11111111-2222-3333-4444-555555555555.webp')
expect('새 URL 에서 같은 key 를 뽑는다', toR2Key(NEW_POST), 'posts/cmtabc/11111111-2222-3333-4444-555555555555.webp')
expect('두 host 의 key 가 동일하다', toR2Key(OLD_POST) === toR2Key(NEW_POST), true)

console.log('\n── 거부해야 하는 주소')

/**
 * 🔴 여기 한 줄이라도 통과하면 남의 서버 이미지가 우리 글에 박히거나,
 *    우리가 지울 수 없는 주소가 대표 사진이 된다.
 */
const MUST_REJECT: ReadonlyArray<readonly [string, string]> = [
  ['http (평문)', 'http://img.soransoran.com/posts/a.webp'],
  ['http (옛 host)', 'http://pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev/posts/a.webp'],
  ['다른 port', 'https://img.soransoran.com:8443/posts/a.webp'],
  ['하위 위장 도메인', 'https://img.soransoran.com.evil.io/posts/a.webp'],
  ['접두 위장', 'https://evil-img.soransoran.com/posts/a.webp'],
  ['서브도메인 추가', 'https://a.img.soransoran.com/posts/a.webp'],
  ['apex 자체', 'https://soransoran.com/posts/a.webp'],
  ['www', 'https://www.soransoran.com/posts/a.webp'],
  ['다른 r2.dev bucket', 'https://pub-0000000000000000000000000000000.r2.dev/posts/a.webp'],
  ['r2.dev 위장', 'https://pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev.evil.io/posts/a.webp'],
  ['외부 host', 'https://example.com/posts/a.webp'],
  ['data:', 'data:image/png;base64,iVBORw0KGgo='],
  ['blob:', 'blob:https://img.soransoran.com/abc'],
  ['상대경로', '/posts/a.webp'],
  ['빈 문자열', ''],
]
for (const [label, url] of MUST_REJECT) {
  expect(`거부: ${label}`, isOwnPublicUrl(url), false)
  expect(`거부(key 추출): ${label}`, toR2Key(url), null)
}

console.log('\n── heroBannerImageUrl 은 두 host 를 받되 경로를 좁힌다')

expect('hero 경로 접두는 /hero-banners/ 다', HERO_BANNER_IMAGE_PATH_PREFIX, '/hero-banners/')
expect('hero host 는 정확히 2개다', HERO_BANNER_IMAGE_HOSTS.length, 2)
expect(
  'hero host 목록과 허용 origin 의 host 가 같다',
  HERO_BANNER_IMAGE_HOSTS.map((h) => `https://${h}`).sort(),
  [...ALLOWED_PUBLIC_ORIGINS].sort(),
)
expect('와일드카드 host 를 쓰지 않는다 (hero)', HERO_BANNER_IMAGE_HOSTS.some((h) => h.includes('*')), false)

/**
 * 🔴 heroBannerImageUrl 은 env 기반 publicUrlFromKey 를 거친다.
 *    그래서 env 가 비어 있는 CI 에서는 **무엇을 넣어도 null** 이다 —
 *    그 상태에서 "posts/ 는 null 이다" 를 확인하면 아무것도 검사하지 않는 셈이다.
 *    (실제로 경로 제한을 지웠는데 통과하는 것을 변이 테스트로 확인했다.)
 *    그래서 env 를 실제로 채운 상태에서 확인한다(withPublicUrl).
 */
/**
 * env 를 잠깐 바꿔 끼우고 한 번 부른 뒤 되돌린다.
 *
 * 🔴 자식 프로세스를 띄우지 않는다. 전에는 r2-public 이 모듈을 읽어 들이는
 *    순간에 env 를 붙잡아 두어서, 값을 바꿔 시험하려면 새 프로세스가 필요했다.
 *    그 실행기(`tsx -e`)가 Node 20 CI 에서 통째로 죽어 15건이 한꺼번에
 *    떨어졌다(run 34920299500 · 로컬 Node 24 에서는 재현되지 않았다).
 *    이제 r2-public 이 부를 때마다 읽으므로 같은 프로세스에서 시험한다 —
 *    실행기·PATH·Node 판본에 기대는 구석이 없다.
 *
 * 🔴 try/finally 로 반드시 되돌린다. 하나가 새면 뒤따르는 검사가
 *    엉뚱한 env 위에서 돌아 조용히 틀린 답을 내놓는다.
 */
function withPublicUrl<T>(publicUrl: string, run: () => T): T {
  const before = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL = publicUrl
  try {
    return run()
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    else process.env.NEXT_PUBLIC_R2_PUBLIC_URL = before
  }
}

function urlUnderEnv(publicUrl: string, key: string): string | null {
  return withPublicUrl(publicUrl, () => publicUrlFromKey(key))
}

function heroUrlUnderEnv(publicUrl: string, key: string): string | null {
  return withPublicUrl(publicUrl, () => heroBannerImageUrl(key))
}

for (const [label, origin] of [['옛 host', OLD_ORIGIN], ['새 host', NEW_ORIGIN]] as const) {
  expect(
    `${label}: hero key 는 주소를 만든다`,
    heroUrlUnderEnv(origin, 'hero-banners/2026/aaa-mobile.webp'),
    `${origin}/hero-banners/2026/aaa-mobile.webp`,
  )
  // 🔴 같은 bucket 의 회원 사진이 next/image 경로로 새지 않는지 — 이 검사가 핵심이다
  expect(`${label}: posts/ key 는 hero 주소로 만들지 않는다`, heroUrlUnderEnv(origin, 'posts/cmt/a.webp'), null)
  expect(`${label}: 앞 슬래시 key 거부`, heroUrlUnderEnv(origin, '/hero-banners/2026/a-mobile.webp'), null)
  expect(`${label}: 상위 경로 key 거부`, heroUrlUnderEnv(origin, 'hero-banners/../posts/a.webp'), null)
}

// 🔴 소스에도 경로 제한이 남아 있는지 이중으로 못 박는다.
const heroImageSrc = readFileSync(join(ROOT, 'src/lib/hero-banner-image.ts'), 'utf8')
expect(
  'heroBannerImageUrl 이 경로 접두를 검사한다',
  /if \(!parsed\.pathname\.startsWith\(HERO_BANNER_IMAGE_PATH_PREFIX\)\) return null/.test(heroImageSrc),
  true,
)
expect(
  'host 비교가 정확히 일치다 (endsWith\u00b7includes 아님)',
  /hosts\.includes\(parsed\.hostname\)/.test(heroImageSrc),
  true,
)

console.log('\n── env 별 URL 생성')

/**
 * 🔴 env 교체가 **실제로 결과를 바꾸는지** 먼저 못 박는다.
 *    r2-public 이 다시 모듈 로드 시점에 값을 붙잡아 두면 여기서 걸린다 —
 *    그렇지 않으면 뒤따르는 "null 을 기대한" 검사들이 우연히 통과해
 *    검사가 있는 척만 하게 된다.
 */
expect(
  'env 교체가 결과를 바꾼다 (모듈 로드 때 붙잡아 두지 않는다)',
  withPublicUrl(OLD_ORIGIN, () => publicUrlFromKey('hero-banners/2026/probe.webp')) !==
    withPublicUrl(NEW_ORIGIN, () => publicUrlFromKey('hero-banners/2026/probe.webp')),
  true,
)

/**
 * 🔴 읽기는 둘, 쓰기는 하나. 새 URL 은 env 가 가리키는 한 곳으로만 만든다.
 */

const HERO_KEY = 'hero-banners/2026/aaa-mobile.webp'
const POST_KEY = 'posts/cmtabc/11111111-2222-3333-4444-555555555555.webp'

expect('env=옛 host → 옛 URL 생성 (hero)', urlUnderEnv(OLD_ORIGIN, HERO_KEY), `${OLD_ORIGIN}/${HERO_KEY}`)
expect('env=새 host → 새 URL 생성 (hero)', urlUnderEnv(NEW_ORIGIN, HERO_KEY), `${NEW_ORIGIN}/${HERO_KEY}`)
expect('env=옛 host → 옛 URL 생성 (posts)', urlUnderEnv(OLD_ORIGIN, POST_KEY), `${OLD_ORIGIN}/${POST_KEY}`)
expect('env=새 host → 새 URL 생성 (posts)', urlUnderEnv(NEW_ORIGIN, POST_KEY), `${NEW_ORIGIN}/${POST_KEY}`)
expect('env=허용 목록 밖 → 만들지 않는다 (fail closed)', urlUnderEnv('https://evil.example.com', HERO_KEY), null)
expect('env=http → 만들지 않는다', urlUnderEnv('http://img.soransoran.com', HERO_KEY), null)
expect('env=미설정 → 만들지 않는다', urlUnderEnv('', HERO_KEY), null)

console.log('\n── 저장된 본문 보존 (sanitize 회귀)')

/**
 * 🔴 post-html.ts 는 server-only 라 여기서 import 하지 않는다.
 *    대신 판정 알맹이(isOwnPublicUrl)가 두 host 를 모두 통과시키는지 보고,
 *    sanitize 가 그 함수를 쓰고 있는지를 소스로 확인한다.
 *    두 겹이 모두 참이면 저장된 본문의 `<img>` 는 살아남는다.
 */
const postHtmlSrc = readFileSync(join(ROOT, 'src/lib/post-html.ts'), 'utf8')
expect(
  'sanitize 가 isOwnPublicUrl 로 이미지를 거른다',
  /return !src \|\| !isOwnPublicUrl\(src\)/.test(postHtmlSrc),
  true,
)
expect(
  'sanitize 가 r2-public 을 직접 쓴다 (판정을 복제하지 않는다)',
  /import \{ isOwnPublicUrl \} from '@\/lib\/r2-public'/.test(postHtmlSrc),
  true,
)
expect('옛 본문 이미지가 살아남는다', isOwnPublicUrl(OLD_POST), true)
expect('새 본문 이미지도 살아남는다', isOwnPublicUrl(NEW_POST), true)
expect('외부 이미지는 여전히 제거 대상이다', isOwnPublicUrl('https://example.com/x.webp'), false)

const postMediaSrc = readFileSync(join(ROOT, 'src/lib/post-media.ts'), 'utf8')
expect(
  '대표 사진(thumbnailUrl) 추출도 같은 판정을 쓴다',
  /import \{ toR2Key, isOwnPublicUrl \} from '@\/lib\/r2-public'/.test(postMediaSrc),
  true,
)

console.log('\n── next.config.js remotePatterns')

const patternHosts = [...NEXT_CONFIG.matchAll(/hostname: '([^']+)'/g)].map((m) => m[1])
expect('remotePatterns host 가 정확히 2개다', patternHosts.length, 2)
expect('remotePatterns host 목록이 코드와 같다', patternHosts.sort(), [...HERO_BANNER_IMAGE_HOSTS].sort())
expect(
  '모든 remotePattern 이 /hero-banners/** 로 좁혀져 있다',
  [...NEXT_CONFIG.matchAll(/pathname: '([^']+)'/g)].map((m) => m[1]),
  ['/hero-banners/**', '/hero-banners/**'],
)
expect('posts 경로를 next/image 에 열지 않는다', /pathname: '\/posts/.test(NEXT_CONFIG), false)
expect('protocol 은 둘 다 https 다', [...NEXT_CONFIG.matchAll(/protocol: '([^']+)'/g)].map((m) => m[1]), ['https', 'https'])

console.log('\n── 업로드 응답은 primary env 주소를 쓴다')

expect(
  '업로드 API 가 publicUrlFromKey 로 url 을 만든다',
  /url: publicUrlFromKey\(key\)/.test(UPLOAD),
  true,
)
expect(
  '업로드 API 가 host 문자열을 직접 적지 않는다',
  /r2\.dev|img\.soransoran\.com/.test(UPLOAD),
  false,
)

console.log('\n══════ 홈 미연동 문구 (보정 A)')

const BANNER_LIST = readFileSync(join(ROOT, 'src/app/admin/(ops)/banners/page.tsx'), 'utf8')
const BANNER_DETAIL = readFileSync(join(ROOT, 'src/app/admin/(ops)/banners/[id]/page.tsx'), 'utf8')
const ACTIVATION_SRC = readFileSync(
  join(ROOT, 'src/components/admin/HeroBannerActivation.tsx'),
  'utf8',
)
const SLOT_SRC = readFileSync(join(ROOT, 'src/components/admin/HeroBannerImageSlot.tsx'), 'utf8')
const EDIT_FORM_SRC = readFileSync(join(ROOT, 'src/components/admin/HeroBannerEditForm.tsx'), 'utf8')
const ROW_CONTROLS_SRC = readFileSync(
  join(ROOT, 'src/components/admin/HeroBannerRowControls.tsx'),
  'utf8',
)

/**
 * 운영자가 **읽는 글자**만 모은다.
 *
 * 🔴 주석을 지우고 본다. 이 저장소의 주석은 "왜 그렇게 쓰지 않는가" 를 설명하느라
 *    금지 문구를 그대로 인용하게 되는데, 그것까지 위반으로 잡으면
 *    설명을 지워야 통과하는 검사가 된다 — 그러면 규칙의 이유가 코드에서 사라진다.
 */
const ADMIN_BANNER_UI = [
  BANNER_LIST,
  BANNER_DETAIL,
  ACTIVATION_SRC,
  SLOT_SRC,
  EDIT_FORM_SRC,
  ROW_CONTROLS_SRC,
]
  .map(stripComments)
  .join('\n')

/**
 * 🔴 PR 2 에서 홈(/)은 HeroBanner 를 읽지 않는다.
 *    그러므로 어드민 화면은 "지금 나가고 있다" 고 말할 수 없다.
 *    한 화면에서 노출을 단정하는 말과 "아직 반영되지 않습니다" 가 함께 보이면
 *    운영자는 둘 중 어느 쪽을 믿어야 할지 알 수 없다.
 */
const EXPOSURE_CLAIMS = [
  '지금 나갈 배너',
  '나가는 중',
  '홈 노출',
  '홈에 나갑니다',
  '홈에서 내려갑니다',
  '홈에 나가지 않습니다',
  '홈에 내보낸다',
  '홈에 뜹니다',
  '홈에 보입니다',
]
for (const claim of EXPOSURE_CLAIMS) {
  expect(`어드민 배너 화면에 '${claim}' 이 없다`, ADMIN_BANNER_UI.includes(claim), false)
}

expect(
  '켜 둔 상태를 "설정이 저장된 상태" 로 말한다',
  /켜 둠 — 설정이 저장된 상태입니다/.test(ACTIVATION_SRC),
  true,
)
expect(
  '홈 연결이 다음 단계임을 목록과 상세 양쪽에 적는다',
  /홈 화면 연결은 다음 단계입니다/.test(BANNER_LIST) &&
    /홈 화면 연결은 다음 단계입니다/.test(BANNER_DETAIL),
  true,
)
expect(
  '예약 구간 안 여부는 안내한다 — 그것은 노출 주장이 아니다',
  /켬 · 구간 안/.test(BANNER_LIST) && /켬 · 구간 밖/.test(BANNER_LIST),
  true,
)
expect(
  '상세 배지도 목록과 같은 말을 쓴다 — 두 화면이 다른 말을 하지 않는다',
  /켬 · 구간 안/.test(BANNER_DETAIL) && /켬 · 구간 밖/.test(BANNER_DETAIL),
  true,
)

console.log('\n══════ 실패한 이미지 미리보기 (보정 B)')

expect(
  '실패 통로가 하나다 — failWith 가 사진을 놓고 이유만 남긴다',
  /const failWith = \(message: string\) => \{\s*releasePick\(\)\s*setUploaded\(null\)\s*setError\(message\)\s*\}/.test(
    SLOT_SRC,
  ),
  true,
)
expect(
  'releasePick 이 revoke · localUrl 비우기 · input 초기화를 한 번에 한다',
  /const releasePick = useCallback\(\(\) => \{[\s\S]*?URL\.revokeObjectURL\(objectUrlRef\.current\)[\s\S]*?setLocalUrl\(null\)[\s\S]*?inputRef\.current\.value = ''[\s\S]*?\}, \[\]\)/.test(
    SLOT_SRC,
  ),
  true,
)

/** 🔴 세 갈래(브라우저 규격 · 서버 응답 · 네트워크) 모두 failWith 로 끝나야 한다. */
const SLOT_CODE = stripComments(SLOT_SRC)
expect('브라우저 규격 실패가 failWith 로 간다', /if \(invalid\) \{\s*failWith\(invalid\.error\)/.test(SLOT_CODE), true)
expect('서버 응답 실패가 failWith 로 간다', /failWith\(message\)/.test(SLOT_CODE), true)
expect('네트워크 실패가 failWith 로 간다', /\} catch \{\s*failWith\(/.test(SLOT_CODE), true)
/**
 * 🔴 실패 경로가 **정확히 셋**이어야 한다 — 브라우저 규격 · 서버 응답 · 네트워크.
 *    넷째 경로가 생기면(예: 타임아웃) 그것도 failWith 를 지나는지 여기서 다시 본다.
 *    정의부는 `failWith = (` 라 이 정규식에 걸리지 않는다 — 세는 것은 호출뿐이다.
 */
expect('failWith 호출이 정확히 3개다', [...SLOT_CODE.matchAll(/failWith\(/g)].length, 3)
expect(
  '성공해도 blob 을 들고 있지 않는다',
  /setUploaded\(\{ \.\.\.result, url: heroBannerImageUrl\(result\.key\) \}\)\s*\n\s*\n?\s*releasePick\(\)/.test(
    SLOT_CODE,
  ),
  true,
)
expect('화면을 떠날 때도 revoke 한다', /return \(\) => \{\s*if \(objectUrlRef\.current\) \{\s*URL\.revokeObjectURL/.test(SLOT_CODE), true)
expect(
  '고른 사진과 저장된 사진을 한 변수로 섞지 않는다',
  /const pendingPreview = localUrl/.test(SLOT_CODE) &&
    /const storedPreview = uploaded\?\.url \?\? storedUrl/.test(SLOT_CODE),
  true,
)
expect(
  '올림 배지는 저장된 key 만 본다 — 고른 사진은 세지 않는다',
  /const ready = Boolean\(uploaded\?\.key \?\? storedKey\)/.test(SLOT_CODE),
  true,
)
expect('옛 preview 변수가 남아 있지 않다', /const preview = /.test(SLOT_CODE), false)

console.log('\n══════ 순서 변경 감사 기록 (보정 C)')

expect(
  'sortOrder 를 고치는 행에 updatedByUserId 를 함께 쓴다',
  /data: \{ sortOrder: position, updatedByUserId: userId \}/.test(ACTIONS),
  true,
)
expect(
  'sortOrder 만 쓰는 update 가 남아 있지 않다',
  /data: \{ sortOrder: position \}/.test(ACTIONS),
  false,
)
expect(
  '반복에서 안 닿은 요청 대상도 기록한다 — 동점이면 번호가 그대로라 건너뛴다',
  /if \(!movedTouched\) \{\s*await tx\.heroBanner\.update\(\{ where: \{ id \}, data: \{ updatedByUserId: userId \} \}\)/.test(
    ACTIONS,
  ),
  true,
)
expect(
  '이미 기록한 행을 두 번 쓰지 않는다',
  /if \(row\.id === id\) movedTouched = true/.test(ACTIONS),
  true,
)
expect('Serializable 구조를 유지한다', /moveHeroBanner[\s\S]*?await inSerializableTx\(/.test(ACTIONS), true)
expect('0..n-1 재정렬 구조를 유지한다', /for \(const \[position, row\] of swapped\.entries\(\)\)/.test(ACTIONS), true)

console.log('\n══════ 활성화 불가 잠금 (보정 D)')

expect(
  'blockedReason 이 있으면 켜기 버튼을 잠근다',
  /disabled=\{pending \|\| Boolean\(blockedReason\)\}/.test(ACTIVATION_SRC),
  true,
)
expect(
  '끄기 버튼에는 이 잠금을 걸지 않는다',
  /deactivateHeroBanner\(bannerId\)/.test(ACTIVATION_SRC) &&
    [...stripComments(ACTIVATION_SRC).matchAll(/disabled=\{pending\}/g)].length === 1,
  true,
)
expect(
  '잠근 이유를 버튼 가까이에 계속 보여 준다',
  /아직 켤 수 없습니다 — \{blockedReason\}/.test(ACTIVATION_SRC),
  true,
)
expect(
  '이미지 업로드가 끝나면 화면을 다시 그린다 — 조건이 풀리면 버튼이 열린다',
  /router\.refresh\(\)/.test(SLOT_CODE),
  true,
)
expect(
  '내용 저장이 끝나도 화면을 다시 그린다',
  /useEffect\(\(\) => \{\s*if \(state\.ok\) router\.refresh\(\)\s*\}, \[state, router\]\)/.test(
    stripComments(EDIT_FORM_SRC),
  ),
  true,
)
expect(
  '서버는 여전히 최종 권위자다 — 액션이 canActivateHeroBanner 를 다시 본다',
  /const blocked = canActivateHeroBanner\(candidate\)/.test(ACTIONS),
  true,
)

console.log('\n══════ 홈 · 다른 화면 무변경')

expect('액션이 / 를 revalidate 하지 않는다', /revalidatePath\('\/'\)/.test(ACTIONS), false)
expect('액션이 /best 를 revalidate 하지 않는다', /revalidatePath\('\/best'\)/.test(ACTIONS), false)
expect(
  '액션은 /admin/banners 만 revalidate 한다',
  [...ACTIONS.matchAll(/revalidatePath\(([^)]+)\)/g)].map((m) => m[1]).sort(),
  ["'/admin/banners'", '`/admin/banners/${id}`'],
)
expect('홈 page 가 배너 조회를 부르지 않는다', /hero-banner/i.test(HOME_PAGE), false)
expect('액션이 Post 를 건드리지 않는다', /prisma\.post\.|tx\.post\./.test(ACTIONS), false)
expect('액션이 User 를 건드리지 않는다', /prisma\.user\.|tx\.user\./.test(ACTIONS), false)
expect(
  '액션이 다루는 테이블은 heroBanner 하나다',
  [...new Set([...ACTIONS.matchAll(/(?:prisma|tx)\.(\w+)\./g)].map((m) => m[1]))],
  ['heroBanner'],
)

// ══════════════════════════════════════════════════════════
/**
 * 타입이 막아 주는 것들.
 *
 * 🔴 이 함수는 **부르지 않는다.** 실행 결과가 아니라 컴파일이 검사다.
 *    @ts-expect-error 가 붙은 줄에서 타입 오류가 사라지면 `npm run typecheck:ops` 가
 *    "쓰이지 않은 @ts-expect-error" 로 실패한다 — 그것이 이 블록의 알람이다.
 */
function typeContracts(): void {
  // @ts-expect-error 슬롯은 mobile · desktop 둘뿐이다
  validateHeroBannerImageMetadata('tablet', { width: 1, height: 1, byteSize: 1, mimeType: 'image/webp' })

  // @ts-expect-error metadata 는 네 값이 모두 있어야 한다
  validateHeroBannerImageMetadata('mobile', { width: 1536, height: 512 })

  // @ts-expect-error 링크 종류는 정해진 셋뿐이다
  resolveHeroBannerLink('POPUP', null)

  // @ts-expect-error 순서를 정하려면 id 가 있어야 한다 — 동점을 가를 수 없다
  sortHeroBanners([{ sortOrder: 0 }])

  // @ts-expect-error 예약 시각은 문자열이 아니라 Date 다 (UTC 저장)
  validateHeroBannerSchedule({ startsAt: '2026-09-20T14:00', endsAt: null })

  // @ts-expect-error 동시 노출을 세려면 후보에 id 가 있어야 한다 — 자기 자신을 가려낼 수 없다
  validateHeroBannerCapacity({ candidate: { ...banner(), id: undefined }, others: [] })

  // @ts-expect-error others 에도 id 가 있어야 한다
  validateHeroBannerCapacity({ candidate: banner(), others: [{ ...banner(), id: undefined }] })

  // @ts-expect-error 초안에도 운영용 이름이 있어야 한다 — 목록에서 구분할 수 없다
  validateHeroBannerDraft({ ...banner(), name: undefined })

  // @ts-expect-error 이미지 key 도 슬롯이 mobile · desktop 둘뿐이다
  validateHeroBannerImageKey('tablet', 'hero-banners/2026/a-mobile.webp')

  // @ts-expect-error 원시 입력은 문자열이다 — Date 를 넣는 자리가 아니다
  parseKstDateTimeLocalInput(new Date(), '시작')

  // @ts-expect-error 시작·종료 원시 입력은 둘 다 넘겨야 한다
  resolveHeroBannerScheduleInput({ startsAt: '2026-09-20T14:00' })
}
void typeContracts

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
