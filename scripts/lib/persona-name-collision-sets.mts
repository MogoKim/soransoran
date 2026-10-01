/**
 * Gate ⑥-B 대조 집합 조회 계층 — 🔴 read-only
 *
 * 정본: docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md §11
 *
 * 🔴 판정부(persona-gate-name-collision.mts)와 분리한다.
 *    판정부는 순수 함수여야 fixture 로 역검증할 수 있다.
 *    ⑥-B 는 Gate ⑤·⑨ 와 달리 외부 상태(회원 닉네임)에 의존하므로
 *    이 분리가 더 중요하다.
 *
 * 🔴 이 파일은 읽기만 한다. UPDATE · INSERT · DELETE 없음.
 * 🔴 조회한 이름 원문을 로그 · 반환 요약에 출력하지 않는다.
 *    반환값은 판정부에 그대로 넘길 배열이며, 사람이 보는 출력은 개수뿐이다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * 🔴 **트랜잭션 클라이언트도 받는다** (2026-09-08).
 *    Gate ⑥-B 를 트랜잭션 **밖에서만** 보면, 그 사이에 회원이 같은 이름을 만들어도
 *    커밋이 그대로 통과한다. 최종 판정은 트랜잭션 안에서 다시 해야 한다.
 *    여기 함수들은 전부 `findMany` 만 쓰므로 두 클라이언트 모두에서 같은 결과를 준다.
 */
type Reader = PrismaClient | Prisma.TransactionClient
import type { NameCollisionSets } from './persona-gate-name-collision.mjs'

/**
 * 실회원 표시명 — 🔴 `User.nickname` ∪ `User.name` 둘 다.
 *
 * 실측(설계 §4-1 · §6-4):
 *   표시명 = nickname ?? name ?? ANONYMOUS_NAME   (src/lib/display-name.ts)
 *   카카오 닉네임은 name 에 들어가고, nickname 은 직접 설정할 때만 채워진다.
 *   🔴 nickname 만 보면 name 만 가진 회원(실측 25%)을 통째로 놓친다.
 *   🔴 name 에는 @unique 가 없어 DB 가 막아주지도 않는다.
 */
export async function loadMemberNames(prisma: Reader): Promise<string[]> {
  // 🔴 (2026-10-01 · #641) Persona 계정은 B1 이 아니라 B3 다 — id 목록으로 뺀다(관계 is:null 필터를 쓰지 않는다)
  const personaUserIds = new Set((await prisma.persona.findMany({ select: { userId: true } })).map((p) => p.userId))
  const users = await prisma.user.findMany({ select: { id: true, nickname: true, name: true } })
  const out: string[] = []
  for (const u of users) {
    if (personaUserIds.has(u.id)) continue
    const nick = u.nickname?.trim()
    const name = u.name?.trim()
    if (nick !== undefined && nick !== '') out.push(nick)
    if (name !== undefined && name !== '') out.push(name)
  }
  return out
}

/**
 * 기존 persona displayName — 🔴 status 와 무관하게 전부(draft · active · paused · **retired**).
 *    은퇴를 빼면 같은 이름이 다시 나타나 회원이 혼동한다(설계 §10).
 *    표시명은 Persona 의 User 행(nickname ∪ name)에 있다 — 화면 표시명과 같은 원천.
 *    🔴 (2026-10-01 · #641) 앞판은 "Persona 모델이 없다" TODO 로 빈 배열을 돌려 B3 가 운영에서 비어 있었다.
 *    `except` 는 자기 자신(재seed · 재판정 대상)의 User id 다.
 */
export async function loadPersonaDisplayNames(prisma: Reader, except: ReadonlySet<string> = new Set()): Promise<string[]> {
  const rows = await prisma.persona.findMany({ select: { userId: true, user: { select: { nickname: true, name: true } } } })
  const out: string[] = []
  for (const r of rows) {
    if (except.has(r.userId)) continue
    for (const n of [r.user.nickname, r.user.name]) {
      const t = n?.trim()
      if (t !== undefined && t !== '') out.push(t)
    }
  }
  return out
}

/** 대조 집합 전체를 모은다. 🔴 read-only */
export async function loadNameCollisionSets(prisma: Reader): Promise<NameCollisionSets> {
  const [memberNames, personaNames] = await Promise.all([
    loadMemberNames(prisma),
    loadPersonaDisplayNames(prisma),
  ])
  return { memberNames, personaNames }
}

/** 🔴 사람이 보는 요약. 이름 원문이 아니라 개수만 돌려준다 */
export function describeSets(sets: NameCollisionSets): string {
  return [
    `회원 표시명 ${sets.memberNames?.length ?? 0}`,
    `persona ${sets.personaNames?.length ?? 0}`,
  ].join(' · ')
}
