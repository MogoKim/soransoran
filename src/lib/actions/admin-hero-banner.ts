'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import {
  canActivateHeroBanner,
  isHeroBannerRuleFailure,
  resolveHeroBannerScheduleInput,
  sortHeroBanners,
  validateHeroBannerAlt,
  validateHeroBannerCapacity,
  validateHeroBannerDraft,
  validateHeroBannerImageKey,
  validateHeroBannerName,
  type HeroBannerCapacityInput,
  type HeroBannerLinkKind,
  type HeroBannerSlot,
} from '@/lib/hero-banner-rules'

/**
 * 히어로 배너 write — 🔴 이 파일이 유일한 지점이다.
 *
 * 🔴 hard delete 를 하지 않는다. prisma.delete · deleteMany 를 쓰지 않는다.
 *    보관(archivedAt)으로 내린다 — 지운 배너는 "언제 무엇이 나갔는가" 도 함께 지운다.
 *
 * 🔴 R2 객체를 지우지 않는다. 이미지를 갈아 끼워도, 보관해도 옛 파일은 남긴다.
 *    참조를 세는 곳이 없어서 지우면 살아 있는 배너의 이미지가 깨질 수 있다
 *    (docs/decisions/post-media-orphan-files.md 와 같은 판단).
 *
 * 🔴 규칙을 여기에 다시 적지 않는다. 전부 hero-banner-rules.ts 를 부른다.
 *    화면(브라우저)도 같은 파일을 부르지만 **서버가 최종 권위자**다 —
 *    서버 액션은 주소만 알면 누구나 부를 수 있어서 화면 검사를 믿을 수 없다.
 *
 * 🔴 전 함수가 requireAdmin 을 **가장 먼저** 통과한다. 통과 못 하면 한 줄도 읽지 않는다.
 *
 * 🔴 동시 노출 5장은 **쓰기와 같은 트랜잭션 안에서** 센다.
 *    밖에서 세고 안에서 쓰면 두 운영자가 동시에 켤 때 6장이 나간다.
 *    Serializable + 충돌 재시도를 쓴다 — raw SQL · advisory lock 을 쓰지 않는다.
 *
 * 🔴 `/` 를 revalidate 하지 않는다. 홈은 아직 이 테이블을 읽지 않는다(PR 3).
 *    읽지도 않는 화면을 다시 그리게 하면 "홈이 바뀐다" 는 오해를 만든다.
 */

export type HeroBannerActionState = { error?: string; ok?: true; id?: string }

const DENIED: HeroBannerActionState = { error: '권한이 없습니다.' }
const NOT_FOUND: HeroBannerActionState = { error: '배너를 찾지 못했습니다.' }

/**
 * 동시 활성화 경쟁에서 다시 시도하는 횟수.
 *
 * 🔴 무한히 돌지 않는다. 운영자가 화면 앞에서 기다리는 자리라
 *    끝없이 재시도하면 "눌렀는데 멈춰 있다" 가 된다. 세 번 실패하면 사람에게 넘긴다.
 */
const SERIALIZABLE_RETRY = 3

/** 규칙 위반을 트랜잭션 밖으로 들고 나오는 통로. 🔴 메시지는 운영자가 그대로 읽는다. */
class HeroBannerRuleError extends Error {}

function revalidateBanners(id?: string): void {
  revalidatePath('/admin/banners')
  if (id) revalidatePath(`/admin/banners/${id}`)
}

async function actorId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}

/** 트랜잭션에서 필요한 것만 — 판정 함수가 요구하는 모양 그대로다. */
const CAPACITY_SELECT = {
  id: true,
  name: true,
  alt: true,
  mobileImageKey: true,
  desktopImageKey: true,
  linkKind: true,
  linkUrl: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  archivedAt: true,
} as const

/**
 * Serializable 트랜잭션 + 충돌 재시도.
 *
 * 🔴 P2034(write conflict / deadlock)만 다시 시도한다.
 *    규칙 위반(HeroBannerRuleError)은 몇 번을 다시 해도 같은 답이므로 즉시 올린다.
 */
async function inSerializableTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastConflict: unknown = null
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (error instanceof HeroBannerRuleError) throw error
      const conflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
      if (!conflict) throw error
      lastConflict = error
    }
  }
  throw lastConflict
}

/**
 * 액션 하나를 감싸는 공통 껍데기.
 *
 * 🔴 규칙 위반은 운영자에게 그대로 보여 준다 — 무엇을 고쳐야 하는지가 그 문장이다.
 * 🔴 그 밖의 실패는 원인을 화면에 흘리지 않는다. 로그에만 남긴다.
 */
async function guard(
  label: string,
  run: () => Promise<HeroBannerActionState>,
): Promise<HeroBannerActionState> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof HeroBannerRuleError) return { error: error.message }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return { error: '다른 작업과 겹쳤습니다. 잠시 후 다시 시도해 주세요.' }
    }
    console.error(`[admin-hero-banner] ${label} 실패:`, (error as Error).message)
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

// ─────────── 폼 읽기 ───────────

function readLinkKind(raw: unknown): HeroBannerLinkKind | null {
  const value = String(raw ?? '')
  return value === 'NONE' || value === 'INTERNAL' || value === 'EXTERNAL' ? value : null
}

/**
 * 편집 폼이 보낸 값을 한 번에 읽는다.
 *
 * 🔴 읽기와 검사를 한 함수가 끝낸다. 두 문을 두면 한쪽만 부르는 날이 온다.
 */
type BannerFormValues = {
  name: string
  alt: string
  linkKind: HeroBannerLinkKind
  linkUrl: string | null
  startsAt: Date | null
  endsAt: Date | null
}

function readBannerForm(formData: FormData): BannerFormValues | HeroBannerActionState {
  const name = String(formData.get('name') ?? '').trim()
  const alt = String(formData.get('alt') ?? '').trim()

  const nameFailure = validateHeroBannerName(name)
  if (nameFailure) return { error: nameFailure.error }

  const altFailure = validateHeroBannerAlt(alt)
  if (altFailure) return { error: altFailure.error }

  const linkKind = readLinkKind(formData.get('linkKind'))
  if (!linkKind) return { error: '링크 종류가 올바르지 않습니다.' }

  const rawUrl = String(formData.get('linkUrl') ?? '').trim()
  const linkUrl = rawUrl === '' ? null : rawUrl

  const schedule = resolveHeroBannerScheduleInput({
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
  })
  if (isHeroBannerRuleFailure(schedule)) return { error: schedule.error }

  const draft = validateHeroBannerDraft({
    name,
    linkKind,
    linkUrl,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
  })
  if (draft) return { error: draft.error }

  return { name, alt, linkKind, linkUrl, startsAt: schedule.startsAt, endsAt: schedule.endsAt }
}

function isActionState(value: unknown): value is HeroBannerActionState {
  return typeof value === 'object' && value !== null && 'error' in value
}

// ─────────── 생성 ───────────

/**
 * 새 배너 초안을 만든다.
 *
 * 🔴 **항상 꺼진 상태로** 만든다. 만들자마자 홈에 나가는 길을 두지 않는다.
 * 🔴 이미지와 설명 없이 저장된다. 첫 장만 올리고 저장하지 못하면
 *    R2 에 주인 없는 파일이 확정적으로 남는다.
 * 🔴 sortOrder 는 맨 뒤다 — 새 배너가 기존 순서를 밀지 않는다.
 */
export async function createHeroBanner(
  _prev: HeroBannerActionState,
  formData: FormData,
): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('create', async () => {
    const name = String(formData.get('name') ?? '').trim()
    const failure = validateHeroBannerName(name)
    if (failure) return { error: failure.error }

    const userId = await actorId()

    const last = await prisma.heroBanner.findFirst({
      where: { archivedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const created = await prisma.heroBanner.create({
      data: {
        name,
        alt: '',
        linkKind: 'NONE',
        sortOrder: (last?.sortOrder ?? -1) + 1,
        isActive: false,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      select: { id: true },
    })

    revalidateBanners(created.id)
    return { ok: true, id: created.id }
  })
}

// ─────────── 수정 ───────────

/**
 * 이름·설명·링크·예약을 고친다. 켜고 끄는 것은 여기서 하지 않는다.
 *
 * 🔴 켜져 있는 배너의 **예약을 넓히는 것**도 동시 노출을 늘린다.
 *    그래서 활성 배너의 수정은 활성화와 똑같이 capacity 를 다시 센다 —
 *    켤 때만 세면 기간을 넓혀 6장을 겹치게 만드는 길이 남는다.
 */
export async function updateHeroBanner(
  _prev: HeroBannerActionState,
  formData: FormData,
): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('update', async () => {
    const id = String(formData.get('bannerId') ?? '')
    if (!id) return NOT_FOUND

    const values = readBannerForm(formData)
    if (isActionState(values)) return values

    const userId = await actorId()

    await inSerializableTx(async (tx) => {
      const current = await tx.heroBanner.findUnique({
        where: { id },
        select: CAPACITY_SELECT,
      })
      if (!current) throw new HeroBannerRuleError('배너를 찾지 못했습니다.')
      if (current.archivedAt) {
        throw new HeroBannerRuleError('보관한 배너는 수정할 수 없습니다. 먼저 보관을 풀어 주세요.')
      }

      // 🔴 바뀐 뒤의 값으로 센다. 지금 값으로 세면 이번 수정의 결과를 보지 못한다.
      const candidate: HeroBannerCapacityInput = {
        ...current,
        ...values,
        archivedAt: null,
      }
      await assertCapacity(tx, candidate)

      await tx.heroBanner.update({
        where: { id },
        data: { ...values, updatedByUserId: userId },
      })
    })

    revalidateBanners(id)
    return { ok: true, id }
  })
}

/**
 * 후보가 들어갔을 때 어느 시각에도 5장을 넘지 않는가.
 *
 * 🔴 같은 트랜잭션의 client(tx)로 읽는다. prisma 전역으로 읽으면
 *    트랜잭션 밖 스냅샷을 보게 되어 Serializable 이 지켜 주지 못한다.
 */
async function assertCapacity(
  tx: Prisma.TransactionClient,
  candidate: HeroBannerCapacityInput,
): Promise<void> {
  // 꺼진 배너는 자리를 차지하지 않는다 — 다른 배너를 읽을 이유도 없다.
  if (!candidate.isActive) return

  const others = await tx.heroBanner.findMany({
    where: { id: { not: candidate.id }, archivedAt: null, isActive: true },
    select: CAPACITY_SELECT,
  })

  const failure = validateHeroBannerCapacity({ candidate, others })
  if (failure) throw new HeroBannerRuleError(failure.error)
}

// ─────────── 켜기 · 끄기 ───────────

/**
 * 배너를 켠다.
 *
 * 🔴 화면이 이미 검사했더라도 **전부 다시 본다** — 이미지 두 장·설명·링크 짝·예약·5장.
 *    서버 액션은 주소만 알면 누구나 부를 수 있다.
 */
export async function activateHeroBanner(id: string): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('activate', async () => {
    if (!id) return NOT_FOUND
    const userId = await actorId()

    await inSerializableTx(async (tx) => {
      const current = await tx.heroBanner.findUnique({ where: { id }, select: CAPACITY_SELECT })
      if (!current) throw new HeroBannerRuleError('배너를 찾지 못했습니다.')

      const candidate: HeroBannerCapacityInput = { ...current, isActive: true }

      const blocked = canActivateHeroBanner(candidate)
      if (blocked) throw new HeroBannerRuleError(blocked.error)

      await assertCapacity(tx, candidate)

      await tx.heroBanner.update({
        where: { id },
        data: { isActive: true, updatedByUserId: userId },
      })
    })

    revalidateBanners(id)
    return { ok: true, id }
  })
}

/**
 * 배너를 끈다.
 *
 * 🔴 끄는 데는 상한을 세지 않는다. 자리를 비우는 조작이라 막을 이유가 없고,
 *    막으면 6장이 된 상태를 되돌릴 길이 사라진다.
 */
export async function deactivateHeroBanner(id: string): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('deactivate', async () => {
    if (!id) return NOT_FOUND
    const userId = await actorId()

    const updated = await prisma.heroBanner.updateMany({
      where: { id },
      data: { isActive: false, updatedByUserId: userId },
    })
    if (updated.count === 0) return NOT_FOUND

    revalidateBanners(id)
    return { ok: true, id }
  })
}

// ─────────── 보관 · 복원 ───────────

/**
 * 보관한다 — 지우지 않는다.
 *
 * 🔴 보관하면서 **함께 끈다.** archivedAt 만 넣고 isActive 를 켠 채 두면
 *    "꺼져 있지 않은 보관 배너" 라는 모순된 행이 남는다.
 * 🔴 R2 객체는 지우지 않는다. 복원하면 그대로 다시 쓴다.
 */
export async function archiveHeroBanner(id: string): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('archive', async () => {
    if (!id) return NOT_FOUND
    const userId = await actorId()

    const updated = await prisma.heroBanner.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date(), isActive: false, updatedByUserId: userId },
    })
    if (updated.count === 0) return { error: '이미 보관한 배너입니다.' }

    revalidateBanners(id)
    return { ok: true, id }
  })
}

/**
 * 보관을 푼다.
 *
 * 🔴 **자동으로 켜지 않는다.** 복원은 "다시 쓸 수 있게 꺼낸다" 는 뜻이지
 *    "지금 내보낸다" 가 아니다. 켜는 것은 운영자가 따로 결정한다 —
 *    자동으로 켜면 기간이 겹쳐 6장이 나가는 일이 조용히 일어난다.
 */
export async function restoreHeroBanner(id: string): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('restore', async () => {
    if (!id) return NOT_FOUND
    const userId = await actorId()

    const updated = await prisma.heroBanner.updateMany({
      where: { id, archivedAt: { not: null } },
      data: { archivedAt: null, isActive: false, updatedByUserId: userId },
    })
    if (updated.count === 0) return { error: '보관 중인 배너가 아닙니다.' }

    revalidateBanners(id)
    return { ok: true, id }
  })
}

// ─────────── 순서 ───────────

/**
 * 한 칸 위·아래로 옮긴다.
 *
 * 🔴 두 행의 sortOrder 를 맞바꾸지 않는다. sortOrder 에 unique 가 없어
 *    같은 값이 이미 있을 수 있고, 그때 맞바꾸면 **아무 일도 일어나지 않는다** —
 *    운영자는 버튼이 고장 났다고 생각한다.
 *    보관하지 않은 목록 전체를 0..n-1 로 다시 매겨 동점을 그 자리에서 없앤다.
 *
 * 🔴 화면과 같은 정렬(sortHeroBanners)로 이웃을 고른다. 다른 순서로 고르면
 *    운영자가 본 화면과 다른 배너가 움직인다.
 *
 * 🔴 순서는 노출 수를 바꾸지 않으므로 capacity 를 세지 않는다.
 *    다만 같은 트랜잭션으로 묶는다 — 중간에 끊기면 순서가 절반만 바뀐다.
 */
export async function moveHeroBanner(
  id: string,
  direction: 'up' | 'down',
): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('move', async () => {
    if (!id) return NOT_FOUND
    if (direction !== 'up' && direction !== 'down') return { error: '알 수 없는 방향입니다.' }
    const userId = await actorId()

    await inSerializableTx(async (tx) => {
      const rows = await tx.heroBanner.findMany({
        where: { archivedAt: null },
        select: { id: true, sortOrder: true },
      })
      const ordered = sortHeroBanners(rows)

      const index = ordered.findIndex((row) => row.id === id)
      if (index === -1) throw new HeroBannerRuleError('옮길 수 있는 배너가 아닙니다.')

      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= ordered.length) {
        throw new HeroBannerRuleError('더 옮길 곳이 없습니다.')
      }

      const swapped = [...ordered]
      const moving = swapped[index]
      const neighbour = swapped[target]
      if (!moving || !neighbour) throw new HeroBannerRuleError('더 옮길 곳이 없습니다.')
      swapped[index] = neighbour
      swapped[target] = moving

      /**
       * 0..n-1 로 다시 매긴다 — 동점이 남아 있으면 다음 이동도 조용히 실패한다.
       *
       * 🔴 sortOrder 를 고치는 행에는 updatedByUserId 를 **함께** 쓴다.
       *    updatedAt 은 @updatedAt 이라 저절로 지금 시각이 되는데,
       *    updatedByUserId 를 빼면 "방금 바뀌었는데 바꾼 사람은 옛날 사람" 인 행이 남는다.
       *    감사 기록이 그런 모양이면 없는 것보다 나쁘다 — 엉뚱한 사람을 가리킨다.
       */
      let movedTouched = false
      for (const [position, row] of swapped.entries()) {
        if (row.sortOrder === position) continue
        await tx.heroBanner.update({
          where: { id: row.id },
          data: { sortOrder: position, updatedByUserId: userId },
        })
        if (row.id === id) movedTouched = true
      }

      /**
       * 🔴 움직임을 요청한 배너가 위 반복에서 안 닿을 수 있다.
       *    동점(예: 전부 sortOrder 0)에서 한 칸 올리면 새 자리의 번호가
       *    원래 값과 같아 건너뛰어진다 — 그래도 운영자는 조작을 한 것이므로 기록을 남긴다.
       *    이미 닿았다면 다시 쓰지 않는다. 같은 행을 두 번 쓸 이유가 없다.
       */
      if (!movedTouched) {
        await tx.heroBanner.update({ where: { id }, data: { updatedByUserId: userId } })
      }
    })

    revalidateBanners(id)
    return { ok: true, id }
  })
}

// ─────────── 이미지 key 반영 ───────────

/**
 * 업로드가 끝난 이미지 key 를 배너에 붙인다.
 *
 * 🔴 업로드 endpoint(/api/admin/hero-banners/upload)만 부른다.
 *    브라우저가 임의의 key 를 보내 붙이는 길을 만들지 않으려고 FormData 를 받지 않는다.
 *
 * 🔴 key 모양을 여기서 **한 번 더** 본다. 만든 곳과 저장하는 곳이 다르므로
 *    한쪽이 바뀌어도 다른 쪽이 막는다.
 *
 * 🔴 옛 key 의 R2 객체를 지우지 않는다. 같은 파일이 다른 배너에 붙어 있을 수 있고
 *    참조를 세는 곳이 없다.
 */
export async function setHeroBannerImageKey(
  id: string,
  slot: HeroBannerSlot,
  key: string,
): Promise<HeroBannerActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  return guard('setImageKey', async () => {
    if (!id) return NOT_FOUND
    if (slot !== 'mobile' && slot !== 'desktop') return { error: '알 수 없는 이미지 자리입니다.' }

    const invalid = validateHeroBannerImageKey(slot, key)
    if (invalid) return { error: invalid.error }

    const userId = await actorId()

    // 🔴 보관한 배너에는 붙이지 않는다 — where 로 막아 경쟁 상태에서도 새지 않게 한다.
    const updated = await prisma.heroBanner.updateMany({
      where: { id, archivedAt: null },
      data:
        slot === 'mobile'
          ? { mobileImageKey: key, updatedByUserId: userId }
          : { desktopImageKey: key, updatedByUserId: userId },
    })
    if (updated.count === 0) return { error: '보관한 배너에는 이미지를 올릴 수 없습니다.' }

    revalidateBanners(id)
    return { ok: true, id }
  })
}
