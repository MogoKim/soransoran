/**
 * Micro Seed 시스템 작성자
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2A · §6-9-E
 *
 * `Post.authorId` 는 NOT NULL 이고 `User` FK 다. Micro Seed 글도 작성자 User row 가
 * 반드시 있어야 한다 — **이 값이 없으면 publisher 는 물리적으로 동작할 수 없다.**
 *
 * 🔴 폴백을 두지 않는다 (§6-9-E)
 *    작성자 ID 가 없을 때 "아무 관리자 계정으로라도 발행" 하면 **누가 썼는지 모르는 글이
 *    커뮤니티에 남는다.** 나중에 takedown 대상을 고를 때 기준이 사라진다.
 *    발행되지 않는 것이 낫다 — 그래서 여기서는 던지고, 부르는 쪽이 FAILED 로 기록한다.
 *
 * 🔴 하드코딩하지 않는다 (§5-2A)
 *    ID 는 설정값으로만 주입한다. 코드에 박아 두면 환경마다 다른 값을 쓸 수 없고,
 *    실수로 실회원 ID 가 커밋에 남을 수 있다.
 *
 * 🚫 회원 계정 재사용 금지
 *    실회원 이름으로 발행되면 신뢰 문제이자 되돌리기 어렵다.
 *    ⚠️ 이 파일은 env 값만 보므로 "그 ID 가 실회원인지" 를 판별할 수 없다.
 *       publisher 는 발행 직전 DB 에서 확인해야 한다 — 🔴 **정본은 `Account` 다**
 *       (2026-09-08 정정). 카카오 로그인이 만드는 것은 `Account` 행이지
 *       `User.providerId` 가 아니다 — NextAuth adapter 는 그 값을 채우지 않는다
 *       (`src/lib/auth.ts` §signIn). 실측: User 9명 전원 providerId=null · Account 3건.
 *       `providerId IS NULL` 만 보면 실회원을 한 명도 못 막는다.
 *       판정은 `src/lib/real-member-gate.ts` `judgeRealMember` 하나뿐이고,
 *       `providerId` 는 수동으로 채워 둔 값을 잡는 **방어적 보조**로만 남는다.
 */

/** 시스템 작성자 ID 를 담는 환경변수. 이 이름 외에는 읽지 않는다 */
export const MICRO_SEED_AUTHOR_ENV = 'SORAN_MICRO_SEED_AUTHOR_ID'

/** §6-9-E — 발행 중단 사유로 그대로 기록된다 */
export class MicroSeedAuthorMissingError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'MicroSeedAuthorMissingError'
  }
}

/**
 * 환경 객체에서 시스템 작성자 ID 를 꺼낸다.
 *
 * 🔴 순수 함수다. `process.env` 를 직접 보지 않으므로 테스트가 실제 환경을 건드리지 않는다.
 *
 * @throws MicroSeedAuthorMissingError 값이 없거나 공백뿐일 때
 */
export function resolveMicroSeedAuthorId(env: Record<string, string | undefined>): string {
  const raw = env[MICRO_SEED_AUTHOR_ENV]

  if (raw === undefined || raw === null) {
    throw new MicroSeedAuthorMissingError(
      `${MICRO_SEED_AUTHOR_ENV} 가 설정되지 않았다. 시스템 작성자 없이 발행하지 않는다 (§6-9-E).`,
    )
  }

  const id = raw.trim()
  if (!id) {
    throw new MicroSeedAuthorMissingError(
      `${MICRO_SEED_AUTHOR_ENV} 가 비어 있다. 시스템 작성자 없이 발행하지 않는다 (§6-9-E).`,
    )
  }

  return id
}

/**
 * 실행 환경에서 시스템 작성자 ID 를 읽는다.
 *
 * 부르는 쪽은 이 함수가 던질 수 있다는 것을 전제로 짠다 —
 * 잡아서 기본값으로 넘어가면 §6-9-E 를 어기는 것이다.
 */
export function getMicroSeedAuthorId(): string {
  return resolveMicroSeedAuthorId(process.env)
}

/**
 * 설정 여부만 조용히 확인한다. 판정용이지 발행 경로가 아니다.
 *
 * 🔴 이 함수의 true 는 "발행해도 된다" 가 아니다 — 값이 실제로 존재하는 User 인지,
 *    실회원이 아닌지는 DB 를 봐야 안다. 발행 경로는 getMicroSeedAuthorId() 를 쓴다.
 */
export function hasMicroSeedAuthorId(env: Record<string, string | undefined> = process.env): boolean {
  try {
    resolveMicroSeedAuthorId(env)
    return true
  } catch {
    return false
  }
}
