'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'

/**
 * 전체 중지 kill switch 제어 — 🔴 이 파일이 유일한 write 경로다
 *
 * 🔴 enabled 의 의미를 여기서 못박는다. 이름 때문에 반대로 읽히기 쉽다.
 *      enabled = true   중지 켜짐 — 모든 페르소나 발화가 멈춘다
 *      enabled = false  중지 꺼짐 — 멈춰 있지 않다
 *      행 없음          false 와 같다 (기본 상태)
 *    "발화 스위치" 가 아니라 "중지 스위치" 다.
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §7-2
 *       전략 §10-2 — kill switch 가 없으면 자동화 2단계를 열 수 없다
 *
 * 🔴 write 대상은 PersonaGlobalSwitch 한 테이블뿐이다.
 *    Persona · User · Post · Comment · PersonaAuditLog 를 건드리지 않는다.
 *
 * 🔴 PersonaAuditLog 에 기록하지 않는다.
 *    그쪽은 "페르소나 정의" 의 변경 이력이고(설계 §10-1),
 *    kill switch 는 특정 페르소나에 속하지 않는 전역 상태다.
 *    PersonaGlobalSwitch 행 자체가 reason · changedBy · changedAt 을 갖는다.
 *
 * 🔴 status 를 바꾸지 않는다. draft → active 는 여기서 하지 않는다.
 */

/** 단일 행으로 운영한다 — 설계 §7-2 */
const SWITCH_ID = 'global'

export type SwitchToggleState = { error?: string; enabled?: boolean }

/**
 * 스위치를 켠다/끈다.
 *
 * @param nextEnabled 다음 **중지** 상태. true = 중지 켜기, false = 중지 해제.
 *   🔴 토글이 아니라 명시값을 받는다 —
 *   토글은 두 사람이 동시에 누르면 의도와 반대가 된다.
 * @param reason 왜 바꾸는가. 🔴 필수다. 사고 상황에서 "누가 왜 멈췄나" 가
 *   기록에 없으면 되돌릴 근거가 사라진다.
 */
export async function setPersonaGlobalSwitch(
  nextEnabled: boolean,
  reason: string,
): Promise<SwitchToggleState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  const actorId = session?.user?.id
  if (!actorId) return { error: '로그인이 필요합니다.' }

  const trimmed = reason.trim()
  if (trimmed === '') return { error: '사유를 적어 주세요.' }
  if (trimmed.length > 200) return { error: '사유는 200자까지 적을 수 있습니다.' }

  try {
    const row = await prisma.personaGlobalSwitch.upsert({
      where: { id: SWITCH_ID },
      // 🔴 upsert 다. 행이 없으면 만들고 있으면 고친다 —
      //    "행 없음 = 중지 꺼짐" 상태에서 처음 중지할 때도 같은 경로를 쓴다.
      create: { id: SWITCH_ID, enabled: nextEnabled, reason: trimmed, changedBy: actorId },
      update: { enabled: nextEnabled, reason: trimmed, changedBy: actorId },
      select: { enabled: true },
    })
    revalidatePath('/admin/personas')
    return { enabled: row.enabled }
  } catch {
    return { error: '변경하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
