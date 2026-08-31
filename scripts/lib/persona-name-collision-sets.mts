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
import type { PrismaClient } from '@prisma/client'
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
export async function loadMemberNames(prisma: PrismaClient): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { nickname: true, name: true } })
  const out: string[] = []
  for (const u of users) {
    const nick = u.nickname?.trim()
    const name = u.name?.trim()
    if (nick !== undefined && nick !== '') out.push(nick)
    if (name !== undefined && name !== '') out.push(name)
  }
  return out
}

/**
 * 기존 persona displayName.
 *
 * 🔴 TODO — `Persona` 모델이 아직 스키마에 없다(2026-08-31 실측).
 *    모델이 생기면 아래를 구현한다:
 *      · status 와 무관하게 전부 읽는다 — draft · active · paused · **retired**
 *        은퇴를 빼면 같은 이름이 다시 나타나 회원이 혼동한다
 *      · 폐기한 이름도 남긴다 — 지우면 다음 작명에서 다시 나온다 (설계 §10)
 *    지금은 빈 배열을 돌려준다. B3 검사가 조용히 통과하는 것이 아니라
 *    **대조할 대상이 0개**라는 뜻이다.
 */
export async function loadPersonaDisplayNames(_prisma: PrismaClient): Promise<string[]> {
  return []
}

/**
 * 크롤 author 해시 — VoiceSource · VoiceCommentSignal 양쪽.
 *
 * 🔴 원문이 없다. salted 단방향 해시라 부분 포함 · 유사도 대조가 불가능하다.
 *    판정부는 이 집합으로 **일치 계열만** 본다 (설계 §4-2).
 */
export async function loadAuthorHashSets(prisma: PrismaClient): Promise<{
  authorHashes: Set<string>
  authorHashNorms: Set<string>
}> {
  const [srcHash, srcNorm, sigHash, sigNorm] = await Promise.all([
    prisma.voiceSource.findMany({
      where: { authorHash: { not: null } },
      select: { authorHash: true }, distinct: ['authorHash'],
    }),
    prisma.voiceSource.findMany({
      where: { authorHashNorm: { not: null } },
      select: { authorHashNorm: true }, distinct: ['authorHashNorm'],
    }),
    prisma.voiceCommentSignal.findMany({
      where: { authorHash: { not: null } },
      select: { authorHash: true }, distinct: ['authorHash'],
    }),
    prisma.voiceCommentSignal.findMany({
      where: { authorHashNorm: { not: null } },
      select: { authorHashNorm: true }, distinct: ['authorHashNorm'],
    }),
  ])
  const authorHashes = new Set<string>()
  const authorHashNorms = new Set<string>()
  for (const r of srcHash) if (r.authorHash !== null) authorHashes.add(r.authorHash)
  for (const r of sigHash) if (r.authorHash !== null) authorHashes.add(r.authorHash)
  for (const r of srcNorm) if (r.authorHashNorm !== null) authorHashNorms.add(r.authorHashNorm)
  for (const r of sigNorm) if (r.authorHashNorm !== null) authorHashNorms.add(r.authorHashNorm)
  return { authorHashes, authorHashNorms }
}

/** 대조 집합 전체를 모은다. 🔴 read-only */
export async function loadNameCollisionSets(prisma: PrismaClient): Promise<NameCollisionSets> {
  const [memberNames, personaNames, hashes] = await Promise.all([
    loadMemberNames(prisma),
    loadPersonaDisplayNames(prisma),
    loadAuthorHashSets(prisma),
  ])
  return {
    memberNames,
    personaNames,
    authorHashes: hashes.authorHashes,
    authorHashNorms: hashes.authorHashNorms,
  }
}

/** 🔴 사람이 보는 요약. 이름 원문이 아니라 개수만 돌려준다 */
export function describeSets(sets: NameCollisionSets): string {
  return [
    `회원 표시명 ${sets.memberNames?.length ?? 0}`,
    `persona ${sets.personaNames?.length ?? 0}`,
    `authorHash ${sets.authorHashes?.size ?? 0}`,
    `authorHashNorm ${sets.authorHashNorms?.size ?? 0}`,
  ].join(' · ')
}
