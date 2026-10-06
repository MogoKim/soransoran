import { BoardType, type Prisma, type PrismaClient } from '@prisma/client'

import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import { AGREEMENT_TYPE } from '@/lib/agreement-policy'
import { EXCLUDE_GREETING, GREETING_CATEGORY } from '@/lib/greeting-policy'
import {
  bucketByAge,
  emptyAgeCounts,
  genderClass,
  isWithinSevenDays,
  kstBaseYear,
  operatorExclusions,
  sevenDayStatus,
  sevenDayWindow,
  ageBandOf,
  type AgeBandKey,
  type AgeCounts,
} from '@/lib/customer-composition'

/**
 * 고객 구성 — 대상 조건과 집계. 정본: MEMBER-CONVERSION-CANON.md v2.1.
 *
 * 🔴 공용 REAL_MEMBER_WHERE 를 고치지 않는다. 그 조각은 회원 관리(미완료·남성 계정의 차단 관리 포함)·
 *    /best·회원 상세가 같이 쓴다. 고객 구성의 대상은 그 위에 조건을 **합성** 해서 만든다.
 *
 * 🔴 이름·닉네임·이메일·전화번호를 select 하지 않는다. 이메일은 운영 계정을 빼는 where 에만 쓴다.
 *    반환값은 전부 숫자다 — 회원 id·출생연도·활동 내역이 화면으로 나가지 않는다.
 *
 * 🔴 db 를 인자로 받는다. 화면은 공용 prisma 를, 격리 DB 검사는 자기 client 를 넘긴다.
 */

type Db = Pick<PrismaClient, 'user' | 'post' | 'comment'>
type Env = Record<string, string | undefined>

// ─────────── 대상 ───────────

/**
 * A. 가입 완료 분석 대상 — 성별을 아직 보지 않는다(성별 미확인·남성 수를 세야 하므로).
 *
 *   카카오 Account · Persona 아님 · OperatorWriter 아님  ← REAL_MEMBER_WHERE 그대로
 *   isOnboarded = true
 *   isAdmin = false
 *   SORAN_ADMIN_EMAILS · SIGNUP_ALLOWLIST 이메일이 아님 (대소문자 무시)
 *   SIGNUP_ALLOWLIST 카카오 회원번호의 Account 가 없음
 *
 * 🔴 이메일 제외를 `NOT: { email: … }` 하나로 쓰지 않는다. Postgres 에서 NULL 과의 비교는
 *    unknown 이라 NOT 을 씌워도 unknown 이고, where 는 그 행을 버린다 — **이메일이 없는
 *    정상 회원이 통째로 빠진다.** null 을 명시적으로 살린다(greeting-policy EXCLUDE_GREETING 과 같은 함정).
 */
export function onboardedBaseWhere(env: Env = process.env): Prisma.UserWhereInput {
  const { emails, providerAccountIds } = operatorExclusions(env)
  const and: Prisma.UserWhereInput[] = []
  if (emails.length > 0) {
    and.push({
      OR: [
        { email: null },
        { NOT: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) } },
      ],
    })
  }
  if (providerAccountIds.length > 0) {
    and.push({
      accounts: { none: { provider: 'kakao', providerAccountId: { in: providerAccountIds } } },
    })
  }
  return {
    ...REAL_MEMBER_WHERE,
    isOnboarded: true,
    isAdmin: false,
    ...(and.length > 0 ? { AND: and } : {}),
  }
}

/** B. 실제 여성 고객 — 구성 총수. 🔴 차단 회원도 포함한다(차단 수는 따로 보여 준다) */
export function femaleCustomerWhere(env: Env = process.env): Prisma.UserWhereInput {
  return { ...onboardedBaseWhere(env), gender: 'female' }
}

/** 참여 지표의 대상 — 실제 여성 고객 중 차단되지 않은 사람. 🔴 차단 회원의 과거 활동은 세지 않는다 */
export function activeFemaleCustomerWhere(env: Env = process.env): Prisma.UserWhereInput {
  return { ...femaleCustomerWhere(env), isBlocked: false }
}

// ─────────── 유효 활동 ───────────

/**
 * 실제 회원 글의 공통 조건 — 공개 상태 · 사람이 씀 · Persona/운영 작성자 아님.
 *
 * 🔴 작성자 조건(대상 회원)과 별개로 글 행에도 건다. 작성자 User 가 실회원이어도
 *    글 쪽 축이 어긋난 행을 회원 활동으로 세지 않는다(schema.prisma Post 41~44행의 세 축).
 */
const MEMBER_POST_BASE = {
  status: 'PUBLISHED',
  source: 'USER',
  personaId: null,
  operatorWriterId: null,
} as const satisfies Prisma.PostWhereInput

/** 일반 글 — 🔴 가입인사를 뺀다. HIDDEN·DELETED 는 상태 조건으로 빠진다 */
export const GENERAL_POST_WHERE: Prisma.PostWhereInput = {
  ...MEMBER_POST_BASE,
  AND: [EXCLUDE_GREETING],
}

/** 가입인사 — 일반 글과 합치지 않는다 */
export const GREETING_POST_WHERE: Prisma.PostWhereInput = {
  ...MEMBER_POST_BASE,
  category: GREETING_CATEGORY,
}

/**
 * 회원 댓글 — MEMBER · 삭제되지 않음 · 공개 글에 남아 있음.
 * 🔴 비회원(GUEST)·Persona·운영(OPERATOR)·Micro Seed 댓글은 commentOrigin 으로 빠진다.
 */
export const MEMBER_COMMENT_WHERE: Prisma.CommentWhereInput = {
  commentOrigin: 'MEMBER',
  source: 'USER',
  isDeleted: false,
  personaId: null,
  operatorWriterId: null,
  post: { status: 'PUBLISHED' },
}

/**
 * 게시판 순서 — Prisma 가 만든 BoardType enum 의 실제 값 전체, schema 선언 순서 그대로.
 *
 * 🔴 문자열 배열로 적지 않는다. 손으로 적은 목록은 schema 에 게시판이 늘어도 따라오지 않아
 *    새 게시판의 활동이 고객 구성에서 조용히 빠진다. enum 객체에서 만들면 prisma generate 만으로 들어온다.
 */
export const COMPOSITION_BOARDS: readonly BoardType[] = Object.values(BoardType)

// ─────────── 집계 결과 ───────────

export type ParticipationByAge = {
  /** 연령 구간별 참여 대상(차단 제외 여성 고객) — 분모 */
  eligible: AgeCounts
  generalPost: AgeCounts
  comment: AgeCounts
  postOrComment: AgeCounts
  greeting: AgeCounts
}

export type BoardParticipation = {
  boardType: BoardType
  /** 이 게시판에 일반 글을 쓴 고유 회원 수 */
  postAuthors: number
  /** 이 게시판 글에 댓글을 쓴 고유 회원 수 */
  commentAuthors: number
}

export type SevenDayParticipation = {
  /** 가입 완료 근거(최초 약관 동의 시각)가 없음 */
  noBasis: number
  /** 7일이 아직 지나지 않음 */
  observing: number
  /** 7일 관측이 끝난 코호트 — 분모 */
  complete: AgeCounts
  /** 그중 [완료, 완료+7일) 안에 일반 글 또는 댓글을 남긴 사람 — 분자 */
  participated: AgeCounts
}

export type CustomerComposition = {
  measuredAt: Date
  baseYear: number
  /** 가입 완료 분석 대상(A) 중 성별 분류 */
  onboarded: { female: number; male: number; genderUnknown: number }
  /** 실제 여성 고객(B) 연령 구간별 — 차단 포함 */
  femaleByAge: AgeCounts
  /** 실제 여성 고객 중 차단 */
  femaleBlocked: number
  participation: ParticipationByAge
  boards: BoardParticipation[]
  sevenDay: SevenDayParticipation
}

/** 7일 창 OR 조건을 한 쿼리에 몇 명씩 묶을지. 🔴 회원마다 따로 묻지 않는다(N+1 금지) */
const SEVEN_DAY_CHUNK = 200

// ─────────── 집계 ───────────

async function countByBirthyear(db: Db, where: Prisma.UserWhereInput, baseYear: number): Promise<AgeCounts> {
  const rows = await db.user.groupBy({ by: ['birthyear'], where, _count: { _all: true } })
  return bucketByAge(
    rows.map((r) => ({ birthyear: r.birthyear, count: r._count._all })),
    baseYear,
  )
}

/**
 * 고객 구성 전체.
 *
 * 쿼리 수 — 구성 1 · 연령대별 참여 5 · 게시판 6 · 7일 코호트 2 + 창 조회 2×⌈코호트/200⌉.
 * 🔴 글·댓글 행을 통째로 가져오지 않는다. 구성과 참여는 groupBy·count·관계 some 으로 DB 가 센다.
 *    행을 읽는 곳은 7일 창 하나뿐이고, 그것도 **코호트 회원 각자의 7일 창 안** 으로 좁힌 뒤
 *    authorId 만 가져온다.
 */
export async function loadCustomerComposition(
  db: Db,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<CustomerComposition> {
  const baseYear = kstBaseYear(now)
  const onboardedWhere = onboardedBaseWhere(env)
  const femaleWhere = femaleCustomerWhere(env)
  const activeWhere = activeFemaleCustomerWhere(env)

  const [composition, eligible, generalPost, comment, postOrComment, greeting, boards, cohort, noBasis] =
    await Promise.all([
      // 성별·출생연도·차단 조합별 인원 — 행 수는 조합 수만큼이다(회원 수가 아니다)
      db.user.groupBy({
        by: ['gender', 'birthyear', 'isBlocked'],
        where: onboardedWhere,
        _count: { _all: true },
      }),
      countByBirthyear(db, activeWhere, baseYear),
      countByBirthyear(db, { ...activeWhere, posts: { some: GENERAL_POST_WHERE } }, baseYear),
      countByBirthyear(db, { ...activeWhere, comments: { some: MEMBER_COMMENT_WHERE } }, baseYear),
      countByBirthyear(
        db,
        {
          ...activeWhere,
          OR: [{ posts: { some: GENERAL_POST_WHERE } }, { comments: { some: MEMBER_COMMENT_WHERE } }],
        },
        baseYear,
      ),
      countByBirthyear(db, { ...activeWhere, posts: { some: GREETING_POST_WHERE } }, baseYear),
      Promise.all(
        COMPOSITION_BOARDS.map(async (boardType) => {
          const [postAuthors, commentAuthors] = await Promise.all([
            db.user.count({ where: { ...activeWhere, posts: { some: { ...GENERAL_POST_WHERE, boardType } } } }),
            db.user.count({
              where: {
                ...activeWhere,
                comments: { some: { ...MEMBER_COMMENT_WHERE, post: { status: 'PUBLISHED', boardType } } },
              },
            }),
          ])
          return { boardType, postAuthors, commentAuthors }
        }),
      ),
      // 7일 코호트 — 회원마다 가장 이른 약관 동의 시각 하나와 출생연도만
      db.user.findMany({
        where: { ...activeWhere, agreements: { some: { type: AGREEMENT_TYPE.terms } } },
        select: {
          id: true,
          birthyear: true,
          agreements: {
            where: { type: AGREEMENT_TYPE.terms },
            select: { agreedAt: true },
            orderBy: { agreedAt: 'asc' },
            take: 1,
          },
        },
      }),
      db.user.count({ where: { ...activeWhere, agreements: { none: { type: AGREEMENT_TYPE.terms } } } }),
    ])

  // 구성
  const onboarded = { female: 0, male: 0, genderUnknown: 0 }
  const femaleRows: { birthyear: string | null; count: number }[] = []
  let femaleBlocked = 0
  for (const row of composition) {
    const n = row._count._all
    const g = genderClass(row.gender)
    if (g === 'female') {
      onboarded.female += n
      femaleRows.push({ birthyear: row.birthyear, count: n })
      if (row.isBlocked) femaleBlocked += n
    } else if (g === 'male') {
      onboarded.male += n
    } else {
      onboarded.genderUnknown += n
    }
  }

  // 7일 내 참여
  const sevenDay: SevenDayParticipation = {
    noBasis,
    observing: 0,
    complete: emptyAgeCounts(),
    participated: emptyAgeCounts(),
  }
  const closed: { id: string; completedAt: Date; band: AgeBandKey }[] = []
  for (const u of cohort) {
    const completedAt = u.agreements[0]?.agreedAt ?? null
    const status = sevenDayStatus(completedAt, now)
    if (status === 'no_basis' || !completedAt) {
      // some 조건으로 골랐으니 오지 않는다. 오면 근거 없음으로 센다 — 임의 날짜로 메우지 않는다
      sevenDay.noBasis += 1
      continue
    }
    if (status === 'observing') {
      sevenDay.observing += 1
      continue
    }
    const band = ageBandOf(u.birthyear, baseYear)
    sevenDay.complete[band] += 1
    closed.push({ id: u.id, completedAt, band })
  }

  const participatedIds = new Set<string>()
  for (let i = 0; i < closed.length; i += SEVEN_DAY_CHUNK) {
    const chunk = closed.slice(i, i + SEVEN_DAY_CHUNK)
    const [posts, comments] = await Promise.all([
      db.post.findMany({
        where: {
          ...GENERAL_POST_WHERE,
          OR: chunk.map((c) => ({ authorId: c.id, createdAt: sevenDayWindow(c.completedAt) })),
        },
        select: { authorId: true, createdAt: true },
        distinct: ['authorId'],
      }),
      db.comment.findMany({
        where: {
          ...MEMBER_COMMENT_WHERE,
          OR: chunk.map((c) => ({ authorId: c.id, createdAt: sevenDayWindow(c.completedAt) })),
        },
        select: { authorId: true, createdAt: true },
        distinct: ['authorId'],
      }),
    ])
    const byId = new Map(chunk.map((c) => [c.id, c.completedAt]))
    for (const row of [...posts, ...comments]) {
      if (!row.authorId) continue
      const completedAt = byId.get(row.authorId)
      // 🔴 DB 창 조건을 순수 함수로 한 번 더 확인한다 — 두 판정이 어긋나면 세지 않는다
      if (completedAt && isWithinSevenDays(completedAt, row.createdAt)) participatedIds.add(row.authorId)
    }
  }
  for (const c of closed) if (participatedIds.has(c.id)) sevenDay.participated[c.band] += 1

  return {
    measuredAt: now,
    baseYear,
    onboarded,
    femaleByAge: bucketByAge(femaleRows, baseYear),
    femaleBlocked,
    participation: { eligible, generalPost, comment, postOrComment, greeting },
    boards,
    sevenDay,
  }
}
