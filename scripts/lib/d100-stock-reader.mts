/**
 * D100 재고 깔때기 **읽기** — 🔴 read-only. DB write 0 · Raw SQL 0 · 네트워크 0
 *
 * 🔴 **판정 규칙을 여기서 만들지 않는다.** profile·사람 검토·freshness·발행 대상은
 *    전부 기존 정본 함수를 부른다 — 규칙을 복제하면 도구마다 다른 답이 나온다.
 *
 * 🔴 **행 집합으로 낸다.** 숫자만 세면 legacy 4건이 빠지고 current 4건이 들어와도
 *    총계가 같아 통과한다. 단계마다 **행 id** 를 들고 다닌다.
 *
 * 🔴 **못 읽으면 0 이 아니라 `readFailed` 다.** 0 으로 채우면 "재고가 없다" 와
 *    "못 읽었다" 가 같은 화면이 된다.
 */
import {
  selectAutoTargets, machineReviewedByHuman, profileOf, type AutoRow,
} from '../../src/lib/original-post-auto-publish'
// 🔴 사람 검토 요구 스위치의 정본은 생성 쪽이다 — 여기서 다시 정하지 않는다
import { MACHINE_AGE_HUMAN_REVIEW_REQUIRED } from '../../src/lib/micro-seed-auto-draft'
/** 🔴 공개 가치 판정 정본 — 러너 · 트랜잭션 · 공급과 같은 함수(2026-09-30 · 옛 F2 복제 신선도 삭제) */
import { judgeSlotRelease } from '../../src/lib/source-slot-release'
import {
  funnelFromRows, judgeFunnelRows,
  type FunnelRead, type FunnelSets, type QueuePostLink,
} from '../../src/lib/d100-readiness'
// 🔴 `QueuePostLink` 는 `StockRepo` 의 타입에 쓰인다 — Queue↔Post 정합은 부르는 쪽이 본다

/**
 * 🔴 **주입 가능한 저장소.** CI 는 가짜를 넣어 "reader 를 빼면 실패하는가" 를 보고,
 *    운영은 진짜 Prisma 를 넣는다. 이 파일은 Prisma 를 import 하지 않는다.
 */
export type StockRepo = {
  /** 🔴 큐 전체 — 발행된 것 포함 */
  queueRows: () => Promise<readonly QueueRowFacts[]>
  /** 🔴 PUBLISHED 행이 가리키는 Post 의 상태 */
  publishedLinks: () => Promise<readonly QueuePostLink[]>
  /** 활성 Persona 수 */
  activePersonas: () => Promise<number>
}

/**
 * 🔴 큐 한 줄 — 원문 증거는 `gateResults.sourceEvidence` 에 있다(AutoRow 가 이미 싣는다).
 *    🔴 `sourceCapturedAt`(초안 시각) · 원문 제목 · 본문을 싣지 않는다 — 옛 복제 신선도(`dayAge` floor 일 ·
 *       키워드 현재성 분기)의 입력이었다.
 */
export type QueueRowFacts = AutoRow

/**
 * 🔴 **한 행 집합에 단계별 selector 를 적용한다.** 각 단계는 앞 단계의 부분집합이다 —
 *    부분집합이 아니게 되면 `judgeFunnelRows` 가 잡는다.
 */
export async function readStockFunnel(input: {
  repo: StockRepo
  now: Date
  safetyOf: (title: string, body: string) => string
  /**
   * 🔴 발행 대상 선정 — 기본은 **정본** `selectAutoTargets` 다.
   *    바꿔 끼울 수 있게 둔 이유는 하나뿐이다: 아래 부분집합 방어가 실제로 동작하는지
   *    시험하려면 **일부러 어긋난 선택기**를 넣어 봐야 한다. 운영은 기본값을 쓴다.
   */
  selectTargets?: (
    rows: readonly QueueRowFacts[], safetyOf: (t: string, b: string) => string,
  ) => { targets: readonly { id: string }[] }
}): Promise<FunnelRead> {
  let rows: readonly QueueRowFacts[]
  try {
    rows = await input.repo.queueRows()
  } catch (e) {
    // 🔴 fail-closed — 0 으로 내려가지 않는다
    return { ok: false, reason: 'readFailed', detail: e instanceof Error ? e.message : '알 수 없음' }
  }

  const id = (r: QueueRowFacts): string => r.id
  const all = rows.map(id)

  // ① 미발행 APPROVED·EDITED — 🔴 발행기와 같은 조건이다
  const unpublished = rows.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))

  // ② legacy 제외 — 🔴 판정은 정본 `profileOf` 가 한다
  const legacyRows = unpublished.filter((r) => profileOf(r) === null)
  const nonLegacy = unpublished.filter((r) => profileOf(r) !== null)

  // ③ profile compatible — 🔴 legacy 를 뺀 것과 같은 집합이다. 이름을 따로 둔다
  const profileCompatible = nonLegacy

  // ④ 사람 검토 — 🔴 기계 글만 요구한다. 사람 글은 그대로다
  const humanReviewed = profileCompatible.filter((r) =>
    !(MACHINE_AGE_HUMAN_REVIEW_REQUIRED && profileOf(r) === 'machine')
    || machineReviewedByHuman(r.decidedBy))

  // ⑤ 공개 가치 — 🔴 정본 `judgeSlotRelease`(지금 슬롯 · 배정은 러너가 본다)
  const fresh = humanReviewed.filter((r) => judgeSlotRelease({
    gateResults: r.gateResults, slotAt: input.now, now: input.now,
    hardGates: { ok: true, codes: [] }, assignment: 'pending', tieBreak: r.id,
  }).verdict === 'eligible')

  // ⑥⑦ Persona 배정·지금 발행 가능 — 🔴 발행기 정본이 고른다
  const select = input.selectTargets ?? selectAutoTargets
  const chosen = select(fresh, input.safetyOf).targets.map((t) => t.id)
  const picked = new Set(chosen)
  // 🔴 고른 것이 앞 단계에 없으면 **그대로 담지 않는다** — 담아 두고 나중에 검사하면
  //    "왜 없는 글이 발행 가능이 됐나" 를 뒤에서 되짚어야 한다
  const personaAssignable = fresh.filter((r) => picked.has(r.id))
  const foreign = chosen.filter((id) => !fresh.some((r) => r.id === id))
  const publishableNow = personaAssignable

  const sets: FunnelSets = {
    all,
    unpublishedApproved: unpublished.map(id),
    nonLegacy: nonLegacy.map(id),
    profileCompatible: profileCompatible.map(id),
    humanReviewed: humanReviewed.map(id),
    fresh: fresh.map(id),
    // 🔴 어긋난 id 를 여기 실어 보낸다 — `judgeFunnelRows` 가 잡아야 할 바로 그 상황이다
    personaAssignable: [...personaAssignable.map(id), ...foreign],
    publishableNow: [...publishableNow.map(id), ...foreign],
  }
  const rowsInput = { sets, legacyIds: legacyRows.map(id) }
  // 🔴 깔때기가 말이 안 되면 숫자를 내지 않는다
  const problems = judgeFunnelRows(rowsInput)
  if (problems.length > 0) {
    // 🔴 코드까지 남긴다 — 무엇이 깨졌는지 이름으로 말할 수 있어야 한다
    return {
      ok: false, reason: 'readFailed',
      detail: problems.map((p) => `${p.code}: ${p.detail}`).join(' · '),
    }
  }
  return {
    ok: true,
    rows: rowsInput,
    // 🔴 예약 건수는 아직 측정하지 않는다 — 0 이 아니라 별도 경로다
    funnel: funnelFromRows({ ...rowsInput, scheduledIn7Days: 0, scheduledIn14Days: 0 }),
  }
}
